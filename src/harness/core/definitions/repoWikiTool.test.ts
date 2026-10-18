import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { REPO_WIKI_TOOL, repoWikiTool } from "./repoWikiTool";

const signal = {} as never;

describe("repo_wiki host tool", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("asks the wiki command about the workspace and returns the page as text", async () => {
    invoke.mockResolvedValue({ result: { status: "ok", markdown: "# src/a.ts" } });
    const result = await repoWikiTool("/ws")({ target: "src/a.ts" }, signal);
    expect(invoke).toHaveBeenCalledWith("repository_wiki_tool", { root: "/ws", activeRepository: null, arguments: { target: "src/a.ts" } });
    await repoWikiTool("/ws", "/ws/web")({ target: "" }, signal);
    expect(invoke).toHaveBeenLastCalledWith("repository_wiki_tool", { root: "/ws", activeRepository: "/ws/web", arguments: { target: "" } });
    expect(result).toEqual({ ok: true, output: JSON.stringify({ status: "ok", markdown: "# src/a.ts" }) });
  });

  it("reports a failure with its code, and an empty workspace without calling anything", async () => {
    invoke.mockImplementation(async () => {
      throw Object.assign(new Error("not a page id"), { code: "invalid_request" });
    });
    expect(await repoWikiTool("/ws")({ target: "x" }, signal)).toEqual({ ok: false, error: "invalid_request: not a page id" });
    expect((await repoWikiTool(" ")({}, signal)).ok).toBe(false);
  });

  it("is a read-only tool with the core tool's schema", () => {
    expect(REPO_WIKI_TOOL.name).toBe("repo_wiki");
    const properties = (REPO_WIKI_TOOL.input_schema as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(properties).sort()).toEqual(["action", "format", "repository", "target"]);
    expect(REPO_WIKI_TOOL.description).toContain("Read-only");
  });
});
