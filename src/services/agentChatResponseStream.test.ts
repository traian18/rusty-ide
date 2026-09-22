import { describe, expect, it } from "vitest";
import type { AgentMessage } from "../store";
import { AgentChatResponseStream } from "./agentChatResponseStream";

function setup() {
  const messages: AgentMessage[] = [];
  const stream = new AgentChatResponseStream(
    (message) => messages.push(message),
    (id, content) => { messages.find((m) => m.id === id)!.content = content; },
  );
  return { stream, messages };
}

describe("Agent conversation streaming", () => {
  it("preserves each model turn and tool progress when the final result arrives", () => {
    const { stream, messages } = setup();
    stream.append("I'll inspect ", "first");
    stream.append("both projects.", "first");
    // A boundary must flush even before the view's batching timer fires.
    stream.append("Now checking the runtime.", "second");
    stream.progress("Found the bridge.\n\nNext: Check the lifecycle.");
    stream.append("I'll now provide the overview.", "third");
    // Same conversation, a fresh message from an automatic continuation.
    stream.append("The frontend is React; ", "final");
    stream.append("the runtime is Rust.", "final");
    stream.finish("The frontend is React; the runtime is Rust.");
    expect(messages.map((m) => m.content)).toEqual([
      "I'll inspect both projects.", "Now checking the runtime.",
      "Found the bridge.\n\nNext: Check the lifecycle.",
      "I'll now provide the overview.", "The frontend is React; the runtime is Rust.",
    ]);
    expect(new Set(messages.map((m) => m.id)).size).toBe(messages.length);
    // The store snapshot persisted to disk contains the same conversation.
    expect(JSON.parse(JSON.stringify(messages))).toEqual(messages);
  });

  it("flushes partial output on failure or cancellation without replacing previous updates", () => {
    const { stream, messages } = setup();
    stream.append("Inspecting files.", "status");
    stream.append("Partial ", "answer");
    stream.append("findings", "answer");
    stream.flush();
    expect(messages.map((m) => m.content)).toEqual(["Inspecting files.", "Partial findings"]);
  });

  it("supports final-only providers and does not overwrite streamed text with a distinct result", () => {
    const { stream, messages } = setup();
    stream.append("Status update.");
    stream.finish("Final answer.");
    expect(messages.map((m) => m.content)).toEqual(["Status update.", "Final answer."]);
    const finalOnly = setup();
    finalOnly.stream.finish("Answer.");
    expect(finalOnly.messages[0].content).toBe("Answer.");
  });
});
