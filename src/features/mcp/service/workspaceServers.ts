// MCP servers belong to a workspace. Each workspace (its root folder) has its
// own server map and its own built-in skill grants; the store's `mcpServers`
// is only the open workspace's map, swapped whenever another one opens. With no
// workspace open there are no servers. Pure functions, no store and no React:
// the store slices and the startup restore step call them.

import type { McpServerConfig } from "../model";

/** One workspace's servers, by name. */
export type McpServerMap = Record<string, McpServerConfig>;
/** Every workspace's servers, by workspace key (see `mcpWorkspaceKey`). */
export type WorkspaceMcpServers = Record<string, McpServerMap>;
/** Every workspace's built-in skill grants: workspace key -> skill id -> server names. */
export type WorkspaceSkillGrants = Record<string, Record<string, string[]>>;

/** What the encrypted config holds about MCP, in either the current or the old app-wide shape. */
export interface SavedMcpConfig {
  mcpServersByWorkspace?: WorkspaceMcpServers;
  builtInSkillMcpGrantsByWorkspace?: WorkspaceSkillGrants;
  /** Old app-wide shape, moved to `lastWorkspacePath` on load. */
  mcpServers?: McpServerMap;
  /** Old app-wide shape, moved to `lastWorkspacePath` on load. */
  builtInSkillMcpServers?: Record<string, string[]>;
  lastWorkspacePath?: string;
}

interface GrantableSkill {
  id: string;
  isBuiltIn?: boolean;
  mcpServers?: string[];
}

/** The key a workspace's servers are stored under: its root path, trimmed, without a trailing separator. */
export function mcpWorkspaceKey(rootPath: string | null | undefined): string {
  const trimmed = (rootPath ?? "").trim();
  if (!trimmed) return "";
  const stripped = trimmed.replace(/[\\/]+$/, "");
  return stripped || trimmed;
}

/** The workspace's servers; none when no workspace is open or it has none. */
export function serversForWorkspace(byWorkspace: WorkspaceMcpServers, rootPath: string): McpServerMap {
  const key = mcpWorkspaceKey(rootPath);
  return key ? { ...(byWorkspace[key] ?? {}) } : {};
}

/** `byWorkspace` with the workspace's servers replaced; an empty map removes the entry. No workspace, no change. */
export function withWorkspaceServers(byWorkspace: WorkspaceMcpServers, rootPath: string, servers: McpServerMap): WorkspaceMcpServers {
  const key = mcpWorkspaceKey(rootPath);
  if (!key) return byWorkspace;
  const next = { ...byWorkspace };
  if (Object.keys(servers).length > 0) next[key] = servers;
  else delete next[key];
  return next;
}

/** `grantsByWorkspace` with one built-in skill's grants in the workspace replaced. No workspace, no change. */
export function withWorkspaceGrant(grantsByWorkspace: WorkspaceSkillGrants, rootPath: string, skillId: string, servers: string[]): WorkspaceSkillGrants {
  const key = mcpWorkspaceKey(rootPath);
  if (!key) return grantsByWorkspace;
  const grants = { ...(grantsByWorkspace[key] ?? {}) };
  if (servers.length > 0) grants[skillId] = [...servers];
  else delete grants[skillId];
  const next = { ...grantsByWorkspace };
  if (Object.keys(grants).length > 0) next[key] = grants;
  else delete next[key];
  return next;
}

/** The open workspace's MCP state: its servers, and the built-in skills carrying its grants (none granted elsewhere). */
export function mcpStateForWorkspace<S extends GrantableSkill>(
  byWorkspace: WorkspaceMcpServers,
  grantsByWorkspace: WorkspaceSkillGrants,
  skills: S[],
  rootPath: string,
): { mcpServers: McpServerMap; skills: S[] } {
  const key = mcpWorkspaceKey(rootPath);
  const grants = key ? grantsByWorkspace[key] ?? {} : {};
  return {
    mcpServers: serversForWorkspace(byWorkspace, rootPath),
    skills: skills.map((skill) => skill.isBuiltIn ? { ...skill, mcpServers: [...(grants[skill.id] ?? [])] } : skill),
  };
}

/** Other workspaces that have servers, for "Copy from another workspace". */
export function otherWorkspacesWithServers(byWorkspace: WorkspaceMcpServers, rootPath: string): { root: string; count: number }[] {
  const current = mcpWorkspaceKey(rootPath);
  return Object.entries(byWorkspace)
    .filter(([root, servers]) => root !== current && Object.keys(servers).length > 0)
    .map(([root, servers]) => ({ root, count: Object.keys(servers).length }))
    .sort((a, b) => a.root.localeCompare(b.root));
}

/** `target` plus the servers of `source` whose names it does not have yet; `copied` counts them. */
export function mergeMissingServers(target: McpServerMap, source: McpServerMap): { servers: McpServerMap; copied: number } {
  const servers = { ...target };
  let copied = 0;
  for (const [name, server] of Object.entries(source)) {
    if (servers[name]) continue;
    servers[name] = { ...server };
    copied += 1;
  }
  return { servers, copied };
}

/**
 * Reads the saved MCP state. The old app-wide shape (one `mcpServers` map and
 * one `builtInSkillMcpServers` map) moves to the last opened workspace; with no
 * such workspace there is nowhere to put it, and it is dropped.
 */
export function readSavedMcp(saved: SavedMcpConfig): { servers: WorkspaceMcpServers; grants: WorkspaceSkillGrants } {
  let servers: WorkspaceMcpServers = { ...(saved.mcpServersByWorkspace ?? {}) };
  let grants: WorkspaceSkillGrants = { ...(saved.builtInSkillMcpGrantsByWorkspace ?? {}) };
  const legacyRoot = mcpWorkspaceKey(saved.lastWorkspacePath);
  if (!legacyRoot) return { servers, grants };
  if (!saved.mcpServersByWorkspace && saved.mcpServers && Object.keys(saved.mcpServers).length > 0) {
    servers = withWorkspaceServers(servers, legacyRoot, { ...saved.mcpServers });
  }
  if (!saved.builtInSkillMcpGrantsByWorkspace && saved.builtInSkillMcpServers) {
    for (const [skillId, names] of Object.entries(saved.builtInSkillMcpServers)) {
      if (Array.isArray(names)) grants = withWorkspaceGrant(grants, legacyRoot, skillId, names);
    }
  }
  return { servers, grants };
}
