import { describe, expect, it } from "vitest";
import { IncompleteAgentRun } from "./incompleteAgentRun";

const tool = { ToolCallCompleted: { call_id: "call", result: { has_error: true, output_preview: "not found" } } };
const text = { AssistantTextDelta: { message_id: "reply", delta: "Done." } };
describe("incomplete agent turn recovery", () => {
  it("does not accept a standalone promise as the answer after tool use", () => {
    const run = new IncompleteAgentRun();
    run.observe(tool);
    for (const delta of ["I", "'ll now provide the comprehensive architectural overview document."]) {
      run.observe({ AssistantTextDelta: { message_id: "reply", delta } });
    }
    expect(run.completion()).toBe("continue");
    run.observe({ AssistantTextDelta: { message_id: "answer", delta: "The project has a React frontend and Rust runtime." } });
    expect(run.completion()).toBe("done");
  });
  it("requires an answer after token exhaustion, even without tools, and caps retries", () => {
    const run = new IncompleteAgentRun();
    run.observe(text);
    run.outputLimitReached();
    expect(run.completion()).toBe("continue");
    expect(run.completion()).toBe("continue");
    expect(run.completion()).toBe("exhausted");
  });
  it.each([
    "I cannot complete this because permission was denied.",
    "I'll provide a summary. The frontend uses React and the runtime uses Rust.",
    "I'll provide the overview:\n\nThe frontend uses React.",
    "Done.",
  ])("accepts a real answer or blocker: %s", (delta) => {
    const run = new IncompleteAgentRun(); run.observe(tool);
    run.observe({ AssistantTextDelta: { message_id: "reply", delta } });
    expect(run.completion()).toBe("done");
  });
  it("continues a turn ending on a failed tool and accepts a subsequent response", () => {
    const run = new IncompleteAgentRun();
    run.observe(text);
    run.observe(tool);
    expect(run.completion()).toBe("continue");
    run.observe(text);
    expect(run.completion()).toBe("done");
  });
  it("bounds continuations even when subsequent turns are empty", () => {
    const run = new IncompleteAgentRun();
    run.observe(tool);
    expect(run.completion()).toBe("continue");
    expect(run.completion()).toBe("continue");
    expect(run.completion()).toBe("exhausted");
  });
  it("does not continue an ordinary completed response or a reported blocker", () => {
    const run = new IncompleteAgentRun();
    expect(run.completion()).toBe("done");
    run.observe(tool);
    run.observe(text);
    expect(run.completion()).toBe("done");
  });
});
