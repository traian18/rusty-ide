import type { McpServerConfig } from "../../mcp";
import { loadStoredThemeId, saveThemeId } from "../../settings";
import { isManagedAuthProvider, isRemovedProviderId, isRemovedProviderModel, normalizeStoredModelReference, normalizeStoredProvider, normalizedProviderId, PROVIDER_CONFIG_VERSION } from "../service/providerHelpers";
import type { CustomProvider, LspSettings, WorkspaceState } from "../../../store/types";

export async function saveSecureConfig(get: () => WorkspaceState): Promise<void> {
  const state = get();
  // Guards against a real data-loss bug: saveSecureConfig writes the
  // ENTIRE snapshot (providers/API keys/lastWorkspacePath/MCP servers),
  // and nine call sites in this file schedule it (via
  // scheduleSaveSecureConfig, above) on nearly every settings mutation.
  // Before loadSecureConfig has completed (or
  // if it failed and the user clicked "Continue anyway"), the store is
  // still holding defaultProviders with empty apiKeys and rootPath: "" --
  // writing that over a real, previously-saved encrypted blob would
  // silently destroy it. secureConfigLoaded is set only once
  // loadSecureConfig finishes (REFACTOR_PLAN.md PR 3a).
  if (!state.secureConfigLoaded) {
    console.warn(
      "saveSecureConfig: skipped -- secure config has not finished loading yet " +
      "(saving now would overwrite it with incomplete/default state).",
    );
    return;
  }
  const { SecureStorageService } = await import("../../settings");
  await SecureStorageService.saveSecureData("rusty_secure_config", {
    configVersion: PROVIDER_CONFIG_VERSION,
    customProviders: state.customProviders,
    activeCustomProviderId: state.activeCustomProviderId,
    activeModel: state.activeModel,
    lastWorkspacePath: state.rootPath,
    mcpServers: state.mcpServers,
    builtInSkillMcpServers: Object.fromEntries(
      state.skills.filter((skill) => skill.isBuiltIn).map((skill) => [skill.id, skill.mcpServers ?? []]),
    ),
    webSearchApiKeys: state.webSearchApiKeys,
    lspSettings: { ...state.lspSettings, enabled: false },
  });
}

export async function loadSecureConfig(
set: (partial: Partial<WorkspaceState>) => void,
get: () => WorkspaceState,
): Promise<void> {
  const { SecureStorageService } = await import("../../settings");
  const config = await SecureStorageService.loadSecureData<{
    configVersion?: number;
    customProviders?: CustomProvider[];
    activeCustomProviderId?: string | null;
    activeModel?: string;
    activeThemeId?: string;
    lastWorkspacePath?: string;
    mcpServers?: Record<string, McpServerConfig>;
    builtInSkillMcpServers?: Record<string, string[]>;
    webSearchApiKeys?: Record<string, string>;
    lspSettings?: LspSettings;
  }>("rusty_secure_config");
  if (!config) {
    // Nothing has ever been saved (e.g. a fresh install) -- that is a
    // successfully "loaded" (empty) state, not a failure, so saving is
    // safe from here on.
    set({ secureConfigLoaded: true });
    return;
  }

  const updates: Partial<WorkspaceState> = {};
  const configVersion = config.configVersion || 0;
  if (config.customProviders) {
    const currentDefaults = get().customProviders;
    const normalizedProviders = config.customProviders
      .filter((provider) => !isRemovedProviderId(provider.id))
      .map((provider) => normalizeStoredProvider(provider, configVersion));
    const savedProviders = new Map(normalizedProviders.map((provider) => [provider.id, provider]));
    const mergedProviders = currentDefaults.map((defaultProvider) => {
      const savedProvider = savedProviders.get(defaultProvider.id);
      return savedProvider
        ? {
            ...defaultProvider,
            ...savedProvider,
            baseUrl: savedProvider.baseUrl || defaultProvider.baseUrl,
            catalogUrl: savedProvider.catalogUrl || defaultProvider.catalogUrl,
            // modelsFetchedAt present means discovery has actually run at
            // least once for this provider -- trust its saved models even
            // when empty, rather than the old behavior (REFACTOR_PLAN.md
            // PR 3b) of silently falling back to the hardcoded defaults
            // for ANY empty saved array, which made "never discovered"
            // and "discovered and legitimately empty" indistinguishable.
            // Absent (an older saved config, or one that's simply never
            // been through discoverModels()) keeps the old fallback.
            models: (savedProvider.modelsFetchedAt && !isManagedAuthProvider(defaultProvider))
              ? savedProvider.models
              : (savedProvider.models?.length ? savedProvider.models : defaultProvider.models),
          }
        : defaultProvider;
    });
    const defaultIds = new Set(currentDefaults.map((provider) => provider.id));
    normalizedProviders.forEach((provider) => {
      if (!defaultIds.has(provider.id)) mergedProviders.push(provider);
    });
    updates.customProviders = mergedProviders;
  }
  if (config.activeCustomProviderId !== undefined) {
    updates.activeCustomProviderId = !config.activeCustomProviderId
      ? null
      : isRemovedProviderId(config.activeCustomProviderId)
      ? "anthropic"
      : normalizedProviderId(config.activeCustomProviderId, configVersion);
  }
  if (config.activeModel) {
    updates.activeModel = isRemovedProviderModel(config.activeModel)
      ? ""
      : normalizeStoredModelReference(config.activeModel, configVersion) || "";
  }
  if (config.mcpServers) updates.mcpServers = config.mcpServers;
  const grants = config.builtInSkillMcpServers;
  if (grants) {
    updates.skills = get().skills.map((skill) =>
      skill.isBuiltIn && Array.isArray(grants[skill.id]) ? { ...skill, mcpServers: grants[skill.id] } : skill,
    );
  }
  if (config.webSearchApiKeys) updates.webSearchApiKeys = config.webSearchApiKeys;
  if (config.lspSettings) updates.lspSettings = { ...config.lspSettings, enabled: false };
  const storedThemeId = loadStoredThemeId();
  if (storedThemeId) {
    // Never let an older asynchronous config snapshot replace the latest
    // theme preference during startup.
    updates.activeThemeId = saveThemeId(storedThemeId);
  } else if (config.activeThemeId) {
    // Migrate themes saved before the dedicated preference became canonical.
    updates.activeThemeId = saveThemeId(config.activeThemeId);
  }
  // The actual restore (a Tauri invoke, then loadWorkspaceData) is a
  // separate startup step (components/shell/startupSteps.ts's
  // "workspace-restore", dependsOn: ["secure-config"]) rather than inline
  // here -- it needs its own, longer timeout budget and must not be able
  // to make this step's OWN critical failure/timeout depend on a slow
  // directory listing. That step is also secureConfigLoaded's sole owner
  // for the "a saved path exists" case (REFACTOR_PLAN.md PR 3a); this
  // action only records the candidate path for it to pick up.
  updates.pendingWorkspaceRestorePath = config.lastWorkspacePath || null;
  set(updates);
}
