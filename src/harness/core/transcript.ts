// ============================================================
// transcript.ts — Accumulates `AssistantTextDelta` content per message_id.
//
// A core session's `Completed` event carries no text of its own (see
// `AgentEvent` in @rusty/harness-sdk's types.ts -- `{ Completed: { outcome
// } }`, nothing else) -- the full response has to be reconstructed from the
// `AssistantTextDelta` stream as it's delivered. Kept as its own module
// (rather than inline state in CoreHarness.run()) so a definition's
// `toResult()` can be unit-tested against a plain `Transcript` without
// driving a whole run.
// ============================================================

export interface Transcript {
  push(messageId: string, delta: string): void;
  /** Accumulated text for one message id, or "" if none arrived. */
  textFor(messageId: string): string;
  /** Every message id that has received at least one delta, in the order
   * each first appeared. */
  messageIds(): readonly string[];
  /** The accumulated text of the last message id to receive a delta -- the
   * common case (inline_chat's single assistant message per run) and the
   * simplest fallback once a run can have more than one message (Milestone
   * C's subagent-bearing capabilities). "" if no delta ever arrived. */
  lastMessageText(): string;
}

export function createTranscript(): Transcript {
  const order: string[] = [];
  const texts = new Map<string, string>();

  return {
    push(messageId, delta) {
      if (!texts.has(messageId)) {
        texts.set(messageId, "");
        order.push(messageId);
      }
      texts.set(messageId, texts.get(messageId) + delta);
    },
    textFor(messageId) {
      return texts.get(messageId) ?? "";
    },
    messageIds() {
      return order;
    },
    lastMessageText() {
      const last = order[order.length - 1];
      return last === undefined ? "" : (texts.get(last) ?? "");
    },
  };
}
