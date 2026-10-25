import { describe, expect, it, vi } from "vitest";
import type { RunHost, ToolExecutionObserver } from "../../contract";
import type { CustomProvider } from "../../../store/types";
import type { SelectorModelInvoker } from "../semanticRead/modelInvoker";
import { resolveReadFileTool } from "./readTool";

const SOURCE = ["import x from 'y';", "", "export function validate() {", "  return true;", "}"].join("\n");
/** Long enough that read_file asks the selector instead of returning it whole. */
const LONG_SOURCE = [SOURCE, ...Array.from({ length: 400 }, (_, i) => `const filler${i} = ${i};`)].join("\n");

function recordingObserver() {
  const observer: ToolExecutionObserver = { executedBy: vi.fn(), usage: vi.fn(), step: vi.fn() };
  return observer;
}

function semanticTool(invoker: SelectorModelInvoker, source = LONG_SOURCE) {
  const host = { readFile: vi.fn(async () => source) } as unknown as RunHost;
  return resolveReadFileTool(
    {
      mode: "semantic",
      selectorModel: {
        providerId: "selector-provider",
        modelId: "selector-model",
        provider: { id: "selector-provider", name: "Selector Co" } as CustomProvider,
      },
    },
    { workspaceRoot: "/ws", host, selectorInvoker: invoker },
  );
}

describe("resolveReadFileTool observability", () => {
  it("reports the selector model as the call's executor, with its usage and steps", async () => {
    const invoker: SelectorModelInvoker = {
      invoke: vi.fn(async (request) => {
        request.onUsage?.({ input_tokens: 50, output_tokens: 10, total_tokens: 60 });
        return JSON.stringify({ ranges: [{ startLine: 3, endLine: 5, reason: "validation" }] });
      }),
    };
    const observer = recordingObserver();

    const outcome = await semanticTool(invoker).handler({ path: "src/a.ts", request: "validation logic" }, new AbortController().signal, observer);

    expect(outcome.ok).toBe(true);
    expect(observer.executedBy).toHaveBeenCalledWith({
      kind: "model",
      purpose: "Smart Read selector",
      model: "selector-model",
      provider: "Selector Co",
      providerId: "selector-provider",
    });
    expect(observer.usage).toHaveBeenCalledWith({ input_tokens: 50, output_tokens: 10, total_tokens: 60 });
    const steps = vi.mocked(observer.step).mock.calls.map(([, message]) => message);
    expect(steps).toContain("selector ranges accepted");
    expect(steps).toContain("semantic read_file completed");
    // The requesting model sees only the excerpt, never the selector's identity.
    expect(String(outcome.ok && outcome.output)).not.toContain("selector-model");
  });

  it("records a selector failure and answers with the parts that name the request's words", async () => {
    const invoker: SelectorModelInvoker = { invoke: vi.fn(async () => { throw new Error("RateLimited { retry_after: None }"); }) };
    const observer = recordingObserver();

    const outcome = await semanticTool(invoker).handler({ path: "src/a.ts", request: "the validate function" }, new AbortController().signal, observer);

    expect(observer.step).toHaveBeenCalledWith("warn", "semantic read_file failed", expect.objectContaining({ path: "src/a.ts" }));
    const output = String(outcome.ok && outcome.output);
    expect(output).toContain("export function validate()");
    expect(output).toContain("Smart Read selector is unavailable (RateLimited");
    // Only the parts around the match, not the whole file.
    expect(output).not.toContain("filler300");
  });

  it("answers a long file read without a request with its first lines, without the selector", async () => {
    const observer = recordingObserver();
    const outcome = await semanticTool({ invoke: vi.fn() }).handler({ path: "src/a.ts" }, new AbortController().signal, observer);

    const output = String(outcome.ok && outcome.output);
    expect(output).toContain("[lines 1-300]");
    expect(output).toContain("these are the first 300");
    expect(observer.executedBy).not.toHaveBeenCalled();
  });
});

describe("resolveReadFileTool large reads", () => {
  const BIG = Array.from({ length: 3_000 }, (_, index) => `line ${index + 1}`).join("\n");

  it("trims a selection over the excerpt limit instead of refusing it, and says what was left out", async () => {
    const invoker: SelectorModelInvoker = {
      invoke: vi.fn(async () => JSON.stringify({ ranges: [{ startLine: 1, endLine: 2_500 }] })),
    };

    const outcome = await semanticTool(invoker, BIG).handler({ path: "big.ts", request: "everything" }, new AbortController().signal);

    expect(outcome.ok).toBe(true);
    const output = String(outcome.ok && outcome.output);
    expect(output).toContain("[lines 1-1000]");
    expect(output).toContain("line 1000");
    expect(output).not.toContain("line 1001\n");
    expect(output).toContain("not returned: lines 1001-2500");
  });

  it("returns exact lines without the selector when start_line/end_line are given", async () => {
    const invoker: SelectorModelInvoker = { invoke: vi.fn() };

    const outcome = await semanticTool(invoker, BIG).handler({ path: "big.ts", start_line: 10, end_line: 12 }, new AbortController().signal);

    expect(invoker.invoke).not.toHaveBeenCalled();
    expect(outcome).toEqual({ ok: true, output: "File: big.ts (3000 lines)\n[lines 10-12]\nline 10\nline 11\nline 12" });
  });

  it("pages a long exact range and says where to continue", async () => {
    const outcome = await semanticTool({ invoke: vi.fn() }, BIG).handler({ path: "big.ts", start_line: 1 }, new AbortController().signal);

    const output = String(outcome.ok && outcome.output);
    expect(output).toContain("[lines 1-2000]");
    expect(output).toContain("Continue with start_line 2001.");
  });

  it("returns a short file whole, without the selector and without needing a request", async () => {
    const invoker: SelectorModelInvoker = { invoke: vi.fn() };
    const observer = recordingObserver();

    const tool = semanticTool(invoker, SOURCE);
    const asked = await tool.handler({ path: "a.ts", request: "the validate function" }, new AbortController().signal, observer);
    const bare = await tool.handler({ path: "a.ts" }, new AbortController().signal);

    expect(invoker.invoke).not.toHaveBeenCalled();
    expect(observer.executedBy).not.toHaveBeenCalled();
    expect(asked).toEqual({ ok: true, output: `File: a.ts (5 lines)\n[lines 1-5]\n${SOURCE}` });
    expect(bare).toEqual(asked);
  });

  it("refuses a malformed line range", async () => {
    const outcome = await semanticTool({ invoke: vi.fn() }).handler({ path: "a.ts", start_line: 5, end_line: 2 }, new AbortController().signal);

    expect(outcome.ok).toBe(false);
  });
});
