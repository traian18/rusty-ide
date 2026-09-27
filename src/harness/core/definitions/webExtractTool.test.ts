import { describe, expect, it, vi } from "vitest";
import type { ToolExecutionObserver } from "../../contract";
import type { CustomProvider } from "../../../store/types";
import type { SelectorModelInvoker } from "../semanticRead/modelInvoker";
import type { WebExtractToolRunConfig } from "../webExtractToolConfig";
import { WEB_EXTRACT_TOOL, resolveWebExtractTool } from "./webExtractTool";

const ENABLED: WebExtractToolRunConfig = {
  enabled: true,
  selectorModel: { providerId: "sel", modelId: "selector-model", provider: { id: "sel", name: "Selector Co" } as CustomProvider },
};
const PAGE = { contentType: "text/html", content: "# Title\nThe answer is 42." };

function recordingObserver(): ToolExecutionObserver {
  return { executedBy: vi.fn(), usage: vi.fn(), step: vi.fn() };
}

const rangesSelector = (): SelectorModelInvoker => ({ invoke: vi.fn(async () => JSON.stringify({ ranges: [{ startLine: 2, endLine: 2 }] })) });

describe("resolveWebExtractTool", () => {
  it("is not offered at all when smart web extraction is off", () => {
    expect(resolveWebExtractTool(undefined, { workspaceRoot: "/ws" })).toBeUndefined();
    expect(resolveWebExtractTool({ enabled: false }, { workspaceRoot: "/ws" })).toBeUndefined();
  });

  it("refuses an enabled config without a selector model", () => {
    expect(() => resolveWebExtractTool({ enabled: true }, { workspaceRoot: "/ws" })).toThrow("Smart web extraction is enabled");
  });

  it("exposes a provider-safe name and a contract that never mentions the selector", () => {
    const tool = resolveWebExtractTool(ENABLED, { workspaceRoot: "/ws", selectorInvoker: rangesSelector(), fetchPage: vi.fn() })!;
    expect(tool.spec).toBe(WEB_EXTRACT_TOOL);
    expect(tool.spec.name).toMatch(/^[a-zA-Z0-9_-]{1,128}$/);
    expect(tool.spec.input_schema).toMatchObject({ required: ["url", "request"], additionalProperties: false });
    expect(JSON.stringify(tool.spec)).not.toMatch(/selector|model|session/i);
  });

  it("fetches privately, extracts, and reports the selector model as the executor", async () => {
    const fetchPage = vi.fn(async () => PAGE);
    const observer = recordingObserver();
    const { handler } = resolveWebExtractTool(ENABLED, { workspaceRoot: "/ws", selectorInvoker: rangesSelector(), fetchPage })!;

    const outcome = await handler({ url: "https://example.com/a", request: "the answer" }, new AbortController().signal, observer);

    expect(fetchPage).toHaveBeenCalledWith("https://example.com/a");
    expect(outcome).toMatchObject({ ok: true });
    expect(String(outcome.ok && outcome.output)).toContain("[lines 2-2] Section: Title\nThe answer is 42.");
    expect(observer.executedBy).toHaveBeenCalledWith({ kind: "model", purpose: "Web Extract selector", model: "selector-model", provider: "Selector Co", providerId: "sel" });
  });

  it.each([
    [{ url: "file:///etc/passwd", request: "x" }, "http(s) url"],
    [{ url: "not a url", request: "x" }, "http(s) url"],
    [{ url: "https://example.com" }, "precise request"],
  ])("rejects %j before fetching or running a model", async (args, message) => {
    const fetchPage = vi.fn();
    const observer = recordingObserver();
    const outcome = await resolveWebExtractTool(ENABLED, { workspaceRoot: "/ws", selectorInvoker: rangesSelector(), fetchPage })!.handler(args, new AbortController().signal, observer);

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error).toContain(message);
    expect(fetchPage).not.toHaveBeenCalled();
    expect(observer.executedBy).not.toHaveBeenCalled();
  });

  it("reports fetch failures and unusable pages without claiming a model ran", async () => {
    const invoker = rangesSelector();
    const observer = recordingObserver();
    const failing = resolveWebExtractTool(ENABLED, { workspaceRoot: "/ws", selectorInvoker: invoker, fetchPage: async () => { throw new Error("refusing to fetch from disallowed address: 10.0.0.1"); } })!;
    expect(await failing.handler({ url: "http://10.0.0.1/", request: "x" }, new AbortController().signal, observer))
      .toEqual({ ok: false, error: "Could not fetch http://10.0.0.1/: refusing to fetch from disallowed address: 10.0.0.1" });

    const binary = resolveWebExtractTool(ENABLED, { workspaceRoot: "/ws", selectorInvoker: invoker, fetchPage: async () => ({ contentType: "image/png", content: "\u0089PNG" }) })!;
    const outcome = await binary.handler({ url: "https://example.com/a.png", request: "x" }, new AbortController().signal, observer);
    expect(!outcome.ok && outcome.error).toContain("supports HTML and text pages");

    expect(invoker.invoke).not.toHaveBeenCalled();
    expect(observer.executedBy).not.toHaveBeenCalled();
  });

  it("drops a fetch that finishes after the call was cancelled", async () => {
    const controller = new AbortController();
    let finish!: (page: typeof PAGE) => void;
    const invoker = rangesSelector();
    const { handler } = resolveWebExtractTool(ENABLED, { workspaceRoot: "/ws", selectorInvoker: invoker, fetchPage: () => new Promise((resolve) => { finish = resolve; }) })!;

    const pending = handler({ url: "https://example.com", request: "x" }, controller.signal);
    controller.abort();
    finish(PAGE);

    expect((await pending).ok).toBe(false);
    expect(invoker.invoke).not.toHaveBeenCalled();
  });
});
