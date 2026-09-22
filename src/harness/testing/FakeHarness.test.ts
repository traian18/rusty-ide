import { describe, expect, it } from "vitest";
import { FakeHarness } from "./FakeHarness";
import { createRecordingHost } from "./recordingHost";
import { describeAgentHarnessContract, type ContractRun } from "./contractTests";
import type { InlineChatInput } from "../contract";

const INPUT: InlineChatInput = {
  sessionId: "s1",
  message: "hi",
  model: "gpt",
  workspaceRoot: "/ws",
  customProvider: null,
  history: [],
  context: {
    filePath: "/a.ts",
    language: "typescript",
    fileContent: "",
    selection: { text: "", startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
  },
};

function startRun(): ContractRun {
  const harness = new FakeHarness();
  const { host, calls } = createRecordingHost();
  const events: ContractRun["events"] = [];
  const handle = harness.run("inline_chat", { ...INPUT }, host, (event) => events.push(event));

  return {
    harness,
    handle,
    events,
    hostCalls: calls,
    driver: {
      acceptStart: () => harness.markStarted(handle.runId),
      requestRead: (path) => {
        void harness.requestRead(handle.runId, path);
      },
      requestWrite: (path, content) => {
        void harness.requestWrite(handle.runId, path, content);
      },
      requestPermission: () => {
        // A real backend implementation is responsible for handling its own
        // rejection on abort (e.g. treating it as "denied"); here we just
        // need to keep it from surfacing as an unhandled rejection in the
        // test itself.
        harness
          .requestPermission(handle.runId, {
            requestId: "p1",
            sessionId: "s1",
            command: { program: "rm", args: [], cwd: "/ws", timeoutMs: 1000 },
            risk: "normal",
            sessionGrantScope: "executable",
            sessionGrantProgram: "rm",
            description: "test",
          })
          .catch(() => {});
      },
      emitToken: (content) => harness.emit(handle.runId, { kind: "token", content }),
      finishWithResult: (response) => harness.complete(handle.runId, { response }),
      finishWithFailure: (message) => harness.fail(handle.runId, { code: "CAPABILITY_FAILED", message }),
    },
  };
}

describeAgentHarnessContract({ name: "FakeHarness", start: startRun });

describe("FakeHarness-specific behavior", () => {
  it("supports() defaults to true and can be overridden per test", () => {
    const harness = new FakeHarness();
    expect(harness.supports("inline_chat", { ...INPUT })).toBe(true);
    harness.setSupports(() => false);
    expect(harness.supports("inline_chat", { ...INPUT })).toBe(false);
  });

  it("releaseSession records the session key", async () => {
    const harness = new FakeHarness();
    await harness.releaseSession("tab-1");
    expect(harness.getReleasedSessions()).toEqual(["tab-1"]);
  });

  it("subscribeUsage delivers usage from any run and unsubscribes cleanly", () => {
    const harness = new FakeHarness();
    const seen: Array<[string, number]> = [];
    const unsubscribe = harness.subscribeUsage((runId, usage) => seen.push([runId, usage.totalTokens ?? 0]));
    harness.emitUsage("run-1", { totalTokens: 42 });
    unsubscribe();
    harness.emitUsage("run-1", { totalTokens: 99 });
    expect(seen).toEqual([["run-1", 42]]);
  });
});
