import { BUILT_IN_SKILLS, DEFAULT_SKILL_ID } from "../../skills";
import { skillsService } from "../../skills";
import { loadStoredThemeId, saveThemeId } from "../../settings";
import { mcpWorkspaceKey, mergeMissingServers, serversForWorkspace, withWorkspaceGrant, withWorkspaceServers, type McpServerMap } from "../../mcp";
import { DEFAULT_THEME_ID, defaultLspSettings, defaultProviders } from "./integrationDefaults";
import { loadSecureConfig, saveSecureConfig } from "./secureConfig";
import { afterProviderDelete } from "../service/chatModel";
import type { WorkspaceSliceCreator } from "../../../store/sliceTypes";
import type { Skill, WorkspaceState } from "../../../store/types";

/**
 * Coalesces every saveSecureConfig trigger within the same tick into one
 * write, instead of the one-`setTimeout(…, 0)`-per-call-site pattern this
 * replaces (REFACTOR_PLAN.md PR 3b). saveSecureConfig writes the ENTIRE
 * encrypted blob through PBKDF2 at 100,000 iterations
 * (services/secureStorageService.ts) -- before this fix, a single "Fetch
 * models" click scheduled two full rewrites (updateProviderSettings, then
 * setActiveModel), and PR 3b's background provider/model discovery would
 * otherwise multiply that into a rewrite storm at every launch. Keyed by
 * `get` (stable per store instance, one per app) via a WeakMap rather than
 * a bare module-level timer, so multiple test stores created in the same
 * process never share a pending timer.
 */
const pendingSaveTimers = new WeakMap<() => WorkspaceState, ReturnType<typeof setTimeout>>();

function scheduleSaveSecureConfig(get: () => WorkspaceState): void {
  if (pendingSaveTimers.has(get)) return;
  const timer = setTimeout(() => {
    pendingSaveTimers.delete(get);
    void get().saveSecureConfig();
  }, 0);
  pendingSaveTimers.set(get, timer);
}

/** The open workspace's servers set to `servers`, in both `mcpServers` and its workspace entry; no workspace open, no change. */
function writeWorkspaceServers(
  state: WorkspaceState,
  get: () => WorkspaceState,
  servers: McpServerMap,
): Partial<WorkspaceState> {
  if (!mcpWorkspaceKey(state.rootPath)) return {};
  scheduleSaveSecureConfig(get);
  return { mcpServers: servers, mcpServersByWorkspace: withWorkspaceServers(state.mcpServersByWorkspace, state.rootPath, servers) };
}

export const createIntegrationSlice: WorkspaceSliceCreator = (set, get) => ({
  customProviders: defaultProviders,
  activeCustomProviderId: "opencode",
  activeModel: "",
  lspSettings: defaultLspSettings,
  skills: BUILT_IN_SKILLS,
  activeSkillId: DEFAULT_SKILL_ID,
  // No hydrate action needed: this was a dead read (localStorage key
  // "rusty_mcp_config" is never written anywhere in the repo -- real MCP
  // restore happens in loadSecureConfig below, from "rusty_secure_config").
  // Deleted outright rather than replaced (REFACTOR_PLAN.md PR 3a).
  mcpServers: {},
  mcpServersByWorkspace: {},
  builtInSkillMcpGrantsByWorkspace: {},
  webSearchApiKeys: {},
  activeThemeId: DEFAULT_THEME_ID,
  secureConfigLoaded: false,
  pendingWorkspaceRestorePath: null,

  updateLspSettings: (settings) => set((state) => {
    scheduleSaveSecureConfig(get);
    return { lspSettings: { ...state.lspSettings, ...settings } };
  }),

  loadSkills: async () => {
    const { rootPath } = get();
    if (!rootPath) return;
    try {
      const userSkills = await skillsService.loadSkills(rootPath);
      const builtInSkills = get().skills.filter((skill) => skill.isBuiltIn);
      const builtInIds = new Set(builtInSkills.map((skill) => skill.id));
      const newUserSkills = userSkills
        .filter((skill: Skill) => !builtInIds.has(skill.id))
        .map((skill: Skill) => ({ ...skill, mcpServers: skill.mcpServers || [] }));
      set({ skills: [...builtInSkills, ...newUserSkills] });
    } catch (error) {
      console.error("Failed to load skills:", error);
    }
  },

  addSkill: (skill) => set((state) => {
    const existing = state.skills.some((candidate) => candidate.id === skill.id);
    return {
      skills: existing
        ? state.skills.map((candidate) => candidate.id === skill.id ? skill : candidate)
        : [...state.skills, skill],
    };
  }),

  updateSkill: (id, updates) => set((state) => {
    // Built-in skills live only in memory; their MCP grants are the one edit
    // persisted (with the secure config, per workspace like the servers they
    // name), since grants are what decide which servers a skill's sessions get.
    const builtInGrant = state.skills.some((skill) => skill.id === id && skill.isBuiltIn) && updates.mcpServers !== undefined;
    if (builtInGrant) scheduleSaveSecureConfig(get);
    return {
      skills: state.skills.map((skill) => skill.id === id
        ? { ...skill, ...updates, updatedAt: new Date().toISOString() }
        : skill),
      ...(builtInGrant
        ? { builtInSkillMcpGrantsByWorkspace: withWorkspaceGrant(state.builtInSkillMcpGrantsByWorkspace, state.rootPath, id, updates.mcpServers ?? []) }
        : {}),
    };
  }),

  deleteSkill: (id) => set((state) => ({
    skills: state.skills.filter((skill) => skill.id !== id),
    activeSkillId: state.activeSkillId === id ? null : state.activeSkillId,
  })),
  setActiveSkill: (activeSkillId) => set({ activeSkillId }),

  // Servers belong to the open workspace: every change writes the open
  // workspace's entry too, and with no workspace open nothing changes.
  setMcpServers: (mcpServers) => set((state) => writeWorkspaceServers(state, get, mcpServers)),
  addMcpServer: (server) => set((state) =>
    writeWorkspaceServers(state, get, { ...state.mcpServers, [server.name]: server })),
  updateMcpServer: (name, updates) => set((state) => {
    const existing = state.mcpServers[name];
    if (!existing) return {};
    return writeWorkspaceServers(state, get, { ...state.mcpServers, [name]: { ...existing, ...updates } });
  }),
  removeMcpServer: (name) => set((state) => {
    const mcpServers = { ...state.mcpServers };
    delete mcpServers[name];
    return writeWorkspaceServers(state, get, mcpServers);
  }),
  copyMcpServersFrom: (sourceRoot) => {
    const state = get();
    if (!mcpWorkspaceKey(state.rootPath)) return 0;
    const { servers, copied } = mergeMissingServers(state.mcpServers, serversForWorkspace(state.mcpServersByWorkspace, sourceRoot));
    if (copied > 0) set(writeWorkspaceServers(state, get, servers));
    return copied;
  },

  setWebSearchApiKey: (provider, key) => set((state) => {
    scheduleSaveSecureConfig(get);
    const webSearchApiKeys = { ...state.webSearchApiKeys };
    if (key.trim()) webSearchApiKeys[provider] = key;
    else delete webSearchApiKeys[provider];
    return { webSearchApiKeys };
  }),

  addCustomProvider: (provider) => set((state) => {
    scheduleSaveSecureConfig(get);
    return { customProviders: [...state.customProviders.filter((item) => item.id !== provider.id), provider] };
  }),
  updateProviderSettings: (providerId, settings) => set((state) => {
    scheduleSaveSecureConfig(get);
    return {
      customProviders: state.customProviders.map((provider) =>
        provider.id === providerId ? { ...provider, ...settings } : provider,
      ),
    };
  }),
  setActiveCustomProviderId: (activeCustomProviderId) => {
    set({ activeCustomProviderId });
    scheduleSaveSecureConfig(get);
  },
  setActiveModel: (activeModel) => {
    set({ activeModel });
    scheduleSaveSecureConfig(get);
  },
  // Chats on the deleted provider's models fall back to the default model when they next show or send.
  deleteProvider: (providerId) => set((state) => {
    if (!state.customProviders.some((provider) => provider.id === providerId)) return {};
    scheduleSaveSecureConfig(get);
    const next = afterProviderDelete(state.customProviders, providerId, defaultProviders, state.activeCustomProviderId, state.activeModel, state.providerStatus);
    return { customProviders: next.providers, activeCustomProviderId: next.selectedProviderId, activeModel: next.defaultModel };
  }),

  addManualModel: (providerId, model) => set((state) => {
    scheduleSaveSecureConfig(get);
    return {
      customProviders: state.customProviders.map((provider) =>
        provider.id === providerId
          ? { ...provider, models: [...provider.models, model] }
          : provider,
      ),
    };
  }),

  removeManualModel: (providerId, modelId) => set((state) => {
    scheduleSaveSecureConfig(get);
    return {
      customProviders: state.customProviders.map((provider) =>
        provider.id === providerId
          ? { ...provider, models: provider.models.filter((m) => m.id !== modelId) }
          : provider,
      ),
    };
  }),

  setActiveThemeId: (themeId) => {
    // This synchronous preference is the source of truth so closing the app
    // cannot interrupt an asynchronous secure-config write.
    const activeThemeId = saveThemeId(themeId);
    set({ activeThemeId });
  },

  // Called from main.tsx, synchronously, before createRoot -- never at
  // slice-creation time. Reproduces exactly the computation the old
  // creation-time initializer ran (REFACTOR_PLAN.md PR 3a).
  hydrateTheme: () => set({ activeThemeId: loadStoredThemeId() || DEFAULT_THEME_ID }),

  saveSecureConfig: () => saveSecureConfig(get),
  loadSecureConfig: () => loadSecureConfig(set, get),
});
