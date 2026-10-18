import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { REPO_AGENT_TOOLS, repoAgentTool } from "./repoAgentTools";

const signal = {} as never;

describe("repository agent tools", () => {
  beforeEach(() => invoke.mockReset());

  it("sends the call to the host with the tool name and returns the answer with its repository", async () => {
    invoke.mockResolvedValue({ result: { status: "ok", summary: "1 file" }, repository: { name: "api" } });
    const result = await repoAgentTool("repo_risk", "/ws", "/ws/api")({ targets: ["src/a.rs"] }, signal);
    expect(invoke).toHaveBeenCalledWith("repository_agent_tool", { root: "/ws", activeRepository: "/ws/api", tool: "repo_risk", arguments: { targets: ["src/a.rs"] } });
    expect(result).toEqual({ ok: true, output: JSON.stringify({ status: "ok", summary: "1 file", repository: { name: "api" } }) });
  });

  it("reports a failure with its code, and calls nothing without a workspace", async () => {
    invoke.mockImplementation(async () => {
      throw Object.assign(new Error("target is required"), { code: "invalid_argument" });
    });
    expect(await repoAgentTool("repo_symbol", "/ws")({}, signal)).toEqual({ ok: false, error: "invalid_argument: target is required" });
    invoke.mockReset();
    expect((await repoAgentTool("repo_symbol", " ")({}, signal)).ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("has one schema per tool, all read-only questions", () => {
    expect(REPO_AGENT_TOOLS.map((t) => t.name)).toEqual(["repo_overview", "repo_health", "repo_risk", "repo_symbol"]);
    for (const tool of REPO_AGENT_TOOLS) expect(tool.description.length).toBeGreaterThan(100);
  });
});
