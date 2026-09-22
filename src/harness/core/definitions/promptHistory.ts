// ============================================================
// definitions/promptHistory.ts — rusty-core has no conversation-history
// seeding yet (upstream ask U2), so every capability that needs prior
// turns folds them into its own prompt text instead, ahead of the
// current message. Shared here since global_explore.ts, execute_node.ts,
// and agent_chat.ts each duplicated the identical duck-typed version of
// this helper -- a fourth (and now fifth) capability needing it was the
// threshold each of those files' own doc comments flagged for factoring
// it out. inline_chat.ts's own flattenHistory is deliberately not
// unified with this one: it takes a typed `ChatMessage[]`, not this
// duck-typed `unknown[]`, since InlineChatInput's history is already
// structurally validated at that call site.
// ============================================================

export function flattenHistory(history: unknown[]): string {
  const turns = history.filter(
    (entry): entry is { role: "user" | "assistant"; content: string } =>
      typeof entry === "object" &&
      entry !== null &&
      ((entry as { role?: unknown }).role === "user" || (entry as { role?: unknown }).role === "assistant") &&
      typeof (entry as { content?: unknown }).content === "string",
  );
  if (turns.length === 0) return "";
  const lines = turns.map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content}`);
  return `${lines.join("\n\n")}\n\n`;
}
