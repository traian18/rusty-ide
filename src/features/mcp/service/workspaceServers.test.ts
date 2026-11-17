import { describe, expect, it } from "vitest";
import { DEFAULT_SERVER_CONFIG, type McpServerConfig } from "../model";
import {
  mcpStateForWorkspace,
  mcpWorkspaceKey,
  mergeMissingServers,
  otherWorkspacesWithServers,
  readSavedMcp,
  serversForWorkspace,
  withWorkspaceGrant,
  withWorkspaceServers,
} from "./workspaceServers";

function server(name: string): McpServerConfig {
  return { ...DEFAULT_SERVER_CONFIG, name, transport: { type: "http", url: `https://${name}.test/mcp` } };
}

describe("mcpWorkspaceKey", () => {
  it("drops trailing separators and whitespace, and is empty with no workspace", () => {
    expect(mcpWorkspaceKey(" /work/a/ ")).toBe("/work/a");
    expect(mcpWorkspaceKey("C:\\work\\a\\")).toBe("C:\\work\\a");
    expect(mcpWorkspaceKey("/")).toBe("/");
    expect(mcpWorkspaceKey("")).toBe("");
    expect(mcpWorkspaceKey(undefined)).toBe("");
  });
});

describe("per-workspace servers", () => {
  it("keeps each workspace's servers apart", () => {
    let byWorkspace = withWorkspaceServers({}, "/work/a", { github: server("github") });
    byWorkspace = withWorkspaceServers(byWorkspace, "/work/b/", { jira: server("jira") });
    expect(Object.keys(serversForWorkspace(byWorkspace, "/work/a"))).toEqual(["github"]);
    expect(Object.keys(serversForWorkspace(byWorkspace, "/work/b"))).toEqual(["jira"]);
    expect(serversForWorkspace(byWorkspace, "/work/c")).toEqual({});
  });

  it("has no servers and takes no writes with no workspace open", () => {
    const byWorkspace = withWorkspaceServers({}, "/work/a", { github: server("github") });
    expect(serversForWorkspace(byWorkspace, "")).toEqual({});
    expect(withWorkspaceServers(byWorkspace, "", { other: server("other") })).toBe(byWorkspace);
  });

  it("removes a workspace's entry once its last server goes", () => {
    const byWorkspace = withWorkspaceServers({}, "/work/a", { github: server("github") });
    expect(withWorkspaceServers(byWorkspace, "/work/a", {})).toEqual({});
  });
});

describe("mcpStateForWorkspace", () => {
  const skills = [
    { id: "plan", isBuiltIn: true, mcpServers: ["github"] },
    { id: "mine", isBuiltIn: false, mcpServers: ["kept"] },
  ];

  it("gives built-in skills the workspace's grants and leaves user skills alone", () => {
    const servers = withWorkspaceServers({}, "/work/b", { jira: server("jira") });
    const grants = withWorkspaceGrant({}, "/work/b", "plan", ["jira"]);
    const state = mcpStateForWorkspace(servers, grants, skills, "/work/b");
    expect(Object.keys(state.mcpServers)).toEqual(["jira"]);
    expect(state.skills[0].mcpServers).toEqual(["jira"]);
    expect(state.skills[1].mcpServers).toEqual(["kept"]);
  });

  it("clears built-in grants in a workspace that has none", () => {
    const state = mcpStateForWorkspace({}, {}, skills, "/work/c");
    expect(state.mcpServers).toEqual({});
    expect(state.skills[0].mcpServers).toEqual([]);
  });
});

describe("copying from another workspace", () => {
  it("lists the other workspaces with servers", () => {
    let byWorkspace = withWorkspaceServers({}, "/work/a", { github: server("github") });
    byWorkspace = withWorkspaceServers(byWorkspace, "/work/b", { jira: server("jira"), docs: server("docs") });
    expect(otherWorkspacesWithServers(byWorkspace, "/work/a/")).toEqual([{ root: "/work/b", count: 2 }]);
  });

  it("copies only the names the target lacks", () => {
    const target = { github: server("github") };
    const source = { github: { ...server("github"), enabled: false }, jira: server("jira") };
    const { servers, copied } = mergeMissingServers(target, source);
    expect(copied).toBe(1);
    expect(servers.github.enabled).toBe(true);
    expect(Object.keys(servers).sort()).toEqual(["github", "jira"]);
  });
});

describe("readSavedMcp", () => {
  it("moves the old app-wide servers and grants to the last opened workspace", () => {
    const saved = readSavedMcp({
      lastWorkspacePath: "/work/a/",
      mcpServers: { github: server("github") },
      builtInSkillMcpServers: { plan: ["github"], build: [] },
    });
    expect(Object.keys(saved.servers)).toEqual(["/work/a"]);
    expect(Object.keys(saved.servers["/work/a"])).toEqual(["github"]);
    expect(saved.grants).toEqual({ "/work/a": { plan: ["github"] } });
  });

  it("prefers the per-workspace shape and ignores old fields beside it", () => {
    const saved = readSavedMcp({
      lastWorkspacePath: "/work/a",
      mcpServersByWorkspace: { "/work/b": { jira: server("jira") } },
      builtInSkillMcpGrantsByWorkspace: {},
      mcpServers: { github: server("github") },
      builtInSkillMcpServers: { plan: ["github"] },
    });
    expect(Object.keys(saved.servers)).toEqual(["/work/b"]);
    expect(saved.grants).toEqual({});
  });

  it("has nowhere to put old servers when no workspace was ever opened", () => {
    expect(readSavedMcp({ mcpServers: { github: server("github") } })).toEqual({ servers: {}, grants: {} });
  });
});
