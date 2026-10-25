import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { capAnswer, REPO_CONTEXT_TOOL, repoContextTool } from "./repoContextTool";

const signal = {} as never;

describe("repo_context host tool", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("asks the repository command about the workspace and returns the answer as text", async () => {
    invoke.mockResolvedValue({ result: { status: "ok", summary: "a.ts is imported by 3 files." }, snapshot: "s1" });
    const result = await repoContextTool("/ws")({ target: "src/a.ts", mode: "blast_radius" }, signal);
    expect(invoke).toHaveBeenCalledWith("repository_context", { root: "/ws", activeRepository: null, arguments: { target: "src/a.ts", mode: "blast_radius", budget: 3000 } });
    expect(result).toEqual({ ok: true, output: JSON.stringify({ status: "ok", summary: "a.ts is imported by 3 files." }) });
  });

  it("tells the host which repository is chosen in the IDE, so a call that names none goes there", async () => {
    invoke.mockResolvedValue({ result: { status: "ok" } });
    await repoContextTool("/ws", "/ws/api")({ target: "src/a.ts" }, signal);
    expect(invoke).toHaveBeenCalledWith("repository_context", { root: "/ws", activeRepository: "/ws/api", arguments: { target: "src/a.ts", budget: 3000 } });
  });

  it("keeps answers small: a default size, a ceiling, and a cut for an answer far over it", async () => {
    invoke.mockResolvedValue({ result: { status: "ok", summary: "x".repeat(20_000) } });
    const result = await repoContextTool("/ws")({ target: "src", budget: 20_000 }, signal);
    expect(invoke).toHaveBeenCalledWith("repository_context", { root: "/ws", activeRepository: null, arguments: { target: "src", budget: 8000 } });
    const output = String(result.ok && result.output);
    expect(output.length).toBeLessThan(12_200);
    expect(output).toContain("Answer cut at 12000 characters");
    expect(capAnswer("short", 3000)).toBe("short");
  });

  it("reports a failure with its code", async () => {
    invoke.mockImplementation(async () => {
      throw Object.assign(new Error("depth must be between 1 and 5"), { code: "limit_exceeded" });
    });
    expect(await repoContextTool("/ws")({ target: "a", depth: 9 }, signal)).toEqual({ ok: false, error: "limit_exceeded: depth must be between 1 and 5" });
  });

  it("does not call anything when no workspace is open", async () => {
    const none = await repoContextTool("  ")({}, signal);
    expect(none.ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("describes a read-only tool whose schema matches the core tool", () => {
    expect(REPO_CONTEXT_TOOL.name).toBe("repo_context");
    const properties = (REPO_CONTEXT_TOOL.input_schema as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(properties).sort()).toEqual(["budget", "depth", "include", "mode", "repository", "target", "targets"]);
    expect(REPO_CONTEXT_TOOL.description).toContain("It only reads");
    // The triggers a model should recognise, so a refactoring task reaches for it.
    for (const trigger of ["FIRST", "moving, renaming, splitting, grouping", "orient", "blast_radius"]) expect(REPO_CONTEXT_TOOL.description).toContain(trigger);
  });
});
