import { describe, expect, it, vi } from "vitest";
import type { ToolExecutionObserver } from "../../contract";
import type { CustomProvider } from "../../../store/types";
import type { SearchToolRunConfig } from "../searchToolConfig";
import type { SelectorModelInvoker } from "../semanticRead/modelInvoker";
import { SEARCH_CODEBASE_TOOL } from "./exploreTools";
import { RANKED_SEARCH_CODEBASE_TOOL, resolveSearchCodebaseTool } from "./searchTool";

const RANKED: SearchToolRunConfig = {
  mode: "ranked",
  selectorModel: { providerId: "sel", modelId: "selector-model", provider: { id: "sel", name: "Selector Co" } as CustomProvider },
};

function recordingObserver(): ToolExecutionObserver {
  return { executedBy: vi.fn(), usage: vi.fn(), step: vi.fn() };
}

describe("resolveSearchCodebaseTool", () => {
  it("keeps the plain pattern search when smart search is off", () => {
    expect(resolveSearchCodebaseTool(undefined, { workspaceRoot: "/ws" }).spec).toBe(SEARCH_CODEBASE_TOOL);
    expect(resolveSearchCodebaseTool({ mode: "raw" }, { workspaceRoot: "/ws" }).spec).toBe(SEARCH_CODEBASE_TOOL);
  });

  it("exposes the same tool name with a request-based contract that never mentions the selector", () => {
    const { spec } = resolveSearchCodebaseTool(RANKED, { workspaceRoot: "/ws", selectorInvoker: { invoke: vi.fn() } });
    expect(spec).toBe(RANKED_SEARCH_CODEBASE_TOOL);
    expect(spec.name).toBe("search_codebase");
    expect(spec.input_schema).toMatchObject({ required: ["request"], additionalProperties: false });
    expect(Object.keys((spec.input_schema as { properties: object }).properties)).toEqual(["request", "path", "include", "max_results"]);
    expect(JSON.stringify(spec)).not.toMatch(/selector|model|session/i);
  });

  it("uses request-based local search when a ranked config has no selector model", () => {
    expect(resolveSearchCodebaseTool({ mode: "ranked" }, { workspaceRoot: "/ws" }).spec).toBe(RANKED_SEARCH_CODEBASE_TOOL);
  });

  it("provides request-based local evidence when the selector is not configured", async () => {
    const search = vi.fn(async () => [
      { path: "/ws/src-old/runtime.ts", name: "runtime.ts", line: 1, content: "start_command", is_content_match: true },
      { path: "/ws/src/runtime.ts", name: "runtime.ts", line: 2, content: "start_command", is_content_match: true },
    ]);
    const tool = resolveSearchCodebaseTool({ mode: "ranked" }, { workspaceRoot: "/ws", search });
    expect(tool.spec).toBe(RANKED_SEARCH_CODEBASE_TOOL);
    const outcome = await tool.handler({ request: "find how runtime starts", path: "src" }, new AbortController().signal);
    expect(outcome.ok).toBe(true);
    expect(String(outcome.ok && outcome.output)).toContain("src/runtime.ts:2");
    expect(String(outcome.ok && outcome.output)).not.toContain("src-old");
    expect(String(outcome.ok && outcome.output)).toContain("unranked");
  });

  it("reports the selector model as the call's executor and passes scope through", async () => {
    const invoker: SelectorModelInvoker = { invoke: vi.fn(async () => JSON.stringify({ queries: [{ pattern: "login" }] })) };
    const search = vi.fn(async () => [{ path: "/ws/src/a.ts", name: "a.ts", line: 2, content: "login()", is_content_match: true }]);
    const observer = recordingObserver();
    const { handler } = resolveSearchCodebaseTool(RANKED, { workspaceRoot: "/ws", selectorInvoker: invoker, search });

    const outcome = await handler({ request: "login flow", path: "src", include: "*.ts", max_results: 5 }, new AbortController().signal, observer);

    expect(outcome).toMatchObject({ ok: true });
    expect(String(outcome.ok && outcome.output)).toContain("src/a.ts:2 | login()");
    expect(observer.executedBy).toHaveBeenCalledWith({ kind: "model", purpose: "Smart Search selector", model: "selector-model", provider: "Selector Co", providerId: "sel" });
    expect(search).toHaveBeenCalledWith("login", false);
    expect(vi.mocked(invoker.invoke).mock.calls[0][0].userPrompt).toContain("Search scope (workspace-relative): src");
  });

  it("falls back to a plain text search for the request's words when the selector fails", async () => {
    const invoker: SelectorModelInvoker = { invoke: vi.fn(async () => { throw new Error("RateLimited { retry_after: None }"); }) };
    const search = vi.fn(async () => [
      { path: "/ws/src/session.rs", name: "session.rs", line: 7, content: "  fn session_runtime() {", is_content_match: true },
      { path: "/ws/docs/session.md", name: "session.md", line: 1, content: "session_runtime notes", is_content_match: true },
    ]);
    const { handler } = resolveSearchCodebaseTool(RANKED, { workspaceRoot: "/ws", selectorInvoker: invoker, search });

    const outcome = await handler({ request: "where is session_runtime started", path: "src" }, new AbortController().signal, recordingObserver());

    const output = String(outcome.ok && outcome.output);
    expect(search).toHaveBeenCalledWith("(session_runtime|started)", true);
    expect(output).toContain("src/session.rs:7 | fn session_runtime() {");
    expect(output).not.toContain("docs/session.md");
    expect(output).toContain("unranked");
  });

  it("keeps include-filtered fallback results in both requested scopes", async () => {
    const invoker: SelectorModelInvoker = { invoke: vi.fn(async () => { throw new Error("provider down"); }) };
    const search = vi.fn(async () => [
      { path: "/ws/src/a.ts", name: "a.ts", line: 1, content: "runtime start", is_content_match: true },
      { path: "/ws/src/a.rs", name: "a.rs", line: 2, content: "runtime start", is_content_match: true },
      { path: "/ws/src-old/a.ts", name: "a.ts", line: 3, content: "runtime start", is_content_match: true },
    ]);
    const { handler } = resolveSearchCodebaseTool(RANKED, { workspaceRoot: "/ws", selectorInvoker: invoker, search });
    const outcome = await handler({ request: "runtime starts", path: "src", include: "*.ts" }, new AbortController().signal, recordingObserver());
    const output = String(outcome.ok && outcome.output);
    expect(output).toContain("src/a.ts:1");
    expect(output).not.toContain("src/a.rs");
    expect(output).not.toContain("src-old");
    expect(output).toContain("unranked");
  });

  it("rejects a missing request before any model runs", async () => {
    const invoker: SelectorModelInvoker = { invoke: vi.fn() };
    const observer = recordingObserver();
    const outcome = await resolveSearchCodebaseTool(RANKED, { workspaceRoot: "/ws", selectorInvoker: invoker }).handler({ pattern: "old style" }, new AbortController().signal, observer);

    expect(outcome.ok).toBe(false);
    expect(invoker.invoke).not.toHaveBeenCalled();
    expect(observer.executedBy).not.toHaveBeenCalled();
  });

  it("returns selector failures as tool errors and records them on the call", async () => {
    const observer = recordingObserver();
    const invoker: SelectorModelInvoker = { invoke: vi.fn(async () => { throw new Error("provider down"); }) };
    const outcome = await resolveSearchCodebaseTool(RANKED, { workspaceRoot: "/ws", selectorInvoker: invoker, search: vi.fn() })
      .handler({ request: "x" }, new AbortController().signal, observer);

    expect(outcome).toEqual({ ok: false, error: "provider down" });
    expect(observer.step).toHaveBeenCalledWith("warn", "smart search_codebase failed", expect.objectContaining({ error: "provider down" }));
  });
});
