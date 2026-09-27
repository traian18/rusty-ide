import { describe, expect, it, vi } from "vitest";
import type { RunHost, ToolExecutionObserver } from "../../contract";
import type { CustomProvider } from "../../../store/types";
import type { SelectorModelInvoker } from "../semanticRead/modelInvoker";
import { resolveReadFileTool } from "./readTool";

const SOURCE = ["import x from 'y';", "", "export function validate() {", "  return true;", "}"].join("\n");

function recordingObserver() {
  const observer: ToolExecutionObserver = { executedBy: vi.fn(), usage: vi.fn(), step: vi.fn() };
  return observer;
}

function semanticTool(invoker: SelectorModelInvoker) {
  const host = { readFile: vi.fn(async () => SOURCE) } as unknown as RunHost;
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

  it("records selector failures on the call without returning the full file", async () => {
    const invoker: SelectorModelInvoker = { invoke: vi.fn(async () => "not json") };
    const observer = recordingObserver();

    const outcome = await semanticTool(invoker).handler({ path: "src/a.ts", request: "validation logic" }, new AbortController().signal, observer);

    expect(outcome.ok).toBe(false);
    expect(observer.step).toHaveBeenCalledWith("warn", "semantic read_file failed", expect.objectContaining({ path: "src/a.ts" }));
  });

  it("does not claim a delegated executor when the request is rejected before the selector runs", async () => {
    const observer = recordingObserver();
    const outcome = await semanticTool({ invoke: vi.fn() }).handler({ path: "src/a.ts" }, new AbortController().signal, observer);

    expect(outcome.ok).toBe(false);
    expect(observer.executedBy).not.toHaveBeenCalled();
  });
});
