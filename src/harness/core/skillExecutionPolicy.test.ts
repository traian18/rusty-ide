import { describe, expect, it } from "vitest";
import { skillExecutionPolicy } from "./skillExecutionPolicy";
import { BUILT_IN_SKILLS } from "../../config/skillDefinitions";

describe("skillExecutionPolicy", () => {
  it("passes every built-in skill's exact saved grants", () => {
    for (const skill of BUILT_IN_SKILLS) {
      expect(skillExecutionPolicy(skill, "execute")).toEqual({ mode: "execute", enabled_tools: skill.enabledTools, allowed_mcp_servers: skill.mcpServers });
    }
  });
  it("passes custom skill tools, selected servers and mode independently", () => {
    expect(skillExecutionPolicy({ enabledTools: ["read_file", "write_file"], mcpServers: ["local-docs"] }, "plan"))
      .toEqual({ mode: "plan", enabled_tools: ["read_file", "write_file"], allowed_mcp_servers: ["local-docs"] });
  });
  it("preserves empty permissions and rejects malformed grants", () => {
    expect(skillExecutionPolicy({ enabledTools: [], mcpServers: [] }, "virtual").enabled_tools).toEqual([]);
    for (const skill of [{}, { enabledTools: "write_file" }, { enabledTools: [false] }, { enabledTools: [], mcpServers: "all" }]) {
      expect(() => skillExecutionPolicy(skill, "execute")).toThrow();
    }
  });
});
