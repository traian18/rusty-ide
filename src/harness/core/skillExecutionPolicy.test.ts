import { describe, expect, it } from "vitest";
import { mcpServerAccess, skillExecutionPolicy } from "./skillExecutionPolicy";
import { mcpIntegrationsSection } from "./mcpPrompt";
import { BUILT_IN_SKILLS } from "../../config/skillDefinitions";
import type { McpServerConfig } from "../../components/mcp/types";

describe("skillExecutionPolicy", () => {
  it("gives every skill, built-in included, exactly the servers ticked for it", () => {
    for (const skill of BUILT_IN_SKILLS) {
      expect(skillExecutionPolicy({ ...skill, mcpServers: ["atlassian"] }, "execute", ["atlassian", "github"])).toEqual({
        mode: "execute",
        enabled_tools: skill.enabledTools,
        allowed_mcp_servers: ["atlassian"],
      });
    }
    expect(skillExecutionPolicy({ enabledTools: [], mcpServers: [] }, "execute", ["atlassian"]).allowed_mcp_servers).toEqual([]);
  });
  it("gives a chat with no skill every tool and every connected server", () => {
    const policy = skillExecutionPolicy(null, "execute", ["atlassian"]);
    expect(policy.allowed_mcp_servers).toEqual(["atlassian"]);
    expect(policy.enabled_tools).toEqual(expect.arrayContaining(["write_file", "web_search"]));
  });
  it("preserves empty permissions and rejects malformed grants", () => {
    expect(skillExecutionPolicy({ enabledTools: [], mcpServers: [] }, "virtual").enabled_tools).toEqual([]);
    for (const skill of [{}, { enabledTools: "write_file" }, { enabledTools: [false] }, { enabledTools: [], mcpServers: "all" }]) {
      expect(() => skillExecutionPolicy(skill, "execute")).toThrow();
    }
  });
});

describe("mcpServerAccess (mirrors rusty-core's mcp_server_access)", () => {
  const policy = (overrides: Partial<ReturnType<typeof skillExecutionPolicy>>) => ({
    mode: "execute" as const,
    enabled_tools: ["write_file", "web_search"],
    allowed_mcp_servers: ["atlassian"],
    ...overrides,
  });
  it("gives full access in execute mode with write_file and web_search", () => {
    expect(mcpServerAccess(policy({}), "atlassian")).toEqual({ access: "full" });
  });
  it("limits plan, virtual, and write-less sessions to read-only tools", () => {
    expect(mcpServerAccess(policy({ mode: "plan" }), "atlassian")).toEqual({ access: "read_only", reason: "plan mode" });
    expect(mcpServerAccess(policy({ mode: "virtual" }), "atlassian").access).toBe("read_only");
    expect(mcpServerAccess(policy({ enabled_tools: ["web_search"] }), "atlassian").access).toBe("read_only");
  });
  it("denies servers that aren't ticked or sessions without network access", () => {
    expect(mcpServerAccess(policy({}), "github")).toMatchObject({ access: "denied", reason: expect.stringContaining("not ticked") });
    expect(mcpServerAccess(policy({ enabled_tools: ["write_file"] }), "atlassian")).toMatchObject({ access: "denied" });
  });
});

describe("mcpIntegrationsSection", () => {
  const specs = [{ name: "atlassian", transport: { kind: "http" as const, url: "https://mcp.atlassian.com/v2/mcp" } }];
  const configs = [{ name: "atlassian", displayName: "Atlassian MCP (Hosted)", description: "Atlassian's hosted Rovo server" }] as McpServerConfig[];

  it("names admitted integrations and tells the model to call their tools", () => {
    const section = mcpIntegrationsSection(specs, configs, skillExecutionPolicy(null, "execute", ["atlassian"]));
    expect(section).toContain("- atlassian: Atlassian MCP (Hosted) — Atlassian's hosted Rovo server");
    expect(section).toContain("call its tools directly");
    expect(section).not.toContain("unavailable in this session");
  });
  it("lists a plan-mode integration as read-only and says why", () => {
    const section = mcpIntegrationsSection(specs, configs, skillExecutionPolicy(null, "plan", ["atlassian"]));
    expect(section).toContain("(read-only tools only, because of plan mode)");
    expect(section).not.toContain("unavailable in this session");
  });
  it("tells the model how to enable an integration the skill doesn't tick", () => {
    const section = mcpIntegrationsSection(specs, configs, skillExecutionPolicy({ enabledTools: ["web_search"], mcpServers: [] }, "execute"));
    expect(section).toContain("unavailable in this session");
    expect(section).toContain("tick the server for the active skill");
    expect(section).not.toContain("Connected MCP integrations");
  });
  it("adds nothing when no integration is connected", () => {
    expect(mcpIntegrationsSection([], [], skillExecutionPolicy(null, "execute"))).toBe("");
  });
});
