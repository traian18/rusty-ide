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

interface Turn {
  role: "user" | "assistant" | "summary";
  content: string;
  pinned: boolean;
}

/** What a chat's running summary replaces in its history (smart compaction).
 * Ids are the chat's own message ids. */
export interface HistorySummaryView {
  /** Condensed account of every turn in `summarizedIds`. */
  text: string;
  summarizedIds: string[];
  /** Turns JEV rated disposable: left out without a mention. */
  droppedIds: string[];
}

/** Turns that fit `budgetChars`: pinned turns and the opening request always
 * stay (a pin is the user's explicit choice, so it may exceed the budget), the
 * newest turns fill what is left, and the most recent turn is never dropped. */
export function selectTurns(turns: Turn[], budgetChars: number): { kept: boolean[]; omitted: number } {
  const total = turns.reduce((sum, turn) => sum + turn.content.length, 0);
  const kept = turns.map(() => total <= budgetChars);
  if (total <= budgetChars) return { kept, omitted: 0 };
  let used = 0;
  const keep = (index: number) => {
    if (kept[index]) return;
    kept[index] = true;
    used += turns[index]!.content.length;
  };
  turns.forEach((turn, index) => { if (turn.pinned) keep(index); });
  if (turns.length > 0) keep(0);
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (kept[index]) continue;
    const isLatest = index === turns.length - 1;
    if (isLatest || used + turns[index]!.content.length <= budgetChars) keep(index);
    else break;
  }
  return { kept, omitted: kept.filter((flag) => !flag).length };
}

/** Swaps the turns a summary covers for one summary entry, placed where the
 * first of them was. Pinned turns and the opening request are never
 * summarized, so they always stay; so does any turn the summary does not list. */
function applySummary(
  turns: Array<Turn & { id?: string }>,
  summary: HistorySummaryView | undefined,
): Turn[] {
  if (!summary) return turns;
  const summarized = new Set(summary.summarizedIds);
  const dropped = new Set(summary.droppedIds);
  const out: Turn[] = [];
  let placed = false;
  turns.forEach((turn, index) => {
    if (index > 0 && turn.id && !turn.pinned) {
      if (dropped.has(turn.id)) return;
      if (summarized.has(turn.id)) {
        if (!placed && summary.text.trim()) out.push({ role: "summary", content: summary.text.trim(), pinned: true });
        placed = true;
        return;
      }
    }
    out.push(turn);
  });
  return out;
}

const LABELS: Record<Turn["role"], string> = { user: "User: ", assistant: "Assistant: ", summary: "Summary of earlier conversation:\n" };

/** `budgetChars` trims long histories while honouring pinned turns; absent
 * means keep everything, as before. `summary` stands in for the turns it
 * covers (smart compaction). */
export function flattenHistory(
  history: unknown[],
  options: { budgetChars?: number; summary?: HistorySummaryView } = {},
): string {
  const parsed = history
    .filter(
      (entry): entry is { role: "user" | "assistant"; content: string; pinned?: unknown; id?: unknown } =>
        typeof entry === "object" &&
        entry !== null &&
        ((entry as { role?: unknown }).role === "user" || (entry as { role?: unknown }).role === "assistant") &&
        typeof (entry as { content?: unknown }).content === "string",
    )
    .map((entry) => ({
      role: entry.role,
      content: entry.content,
      pinned: entry.pinned === true,
      ...(typeof entry.id === "string" ? { id: entry.id } : {}),
    }));
  const turns = applySummary(parsed, options.summary);
  if (turns.length === 0) return "";
  const { kept } = options.budgetChars === undefined ? { kept: turns.map(() => true) } : selectTurns(turns, options.budgetChars);
  const lines: string[] = [];
  let gap = 0;
  const flushGap = () => {
    if (gap > 0) lines.push(`[… ${gap} earlier message${gap === 1 ? "" : "s"} omitted to save context]`);
    gap = 0;
  };
  turns.forEach((turn, index) => {
    if (!kept[index]) { gap += 1; return; }
    flushGap();
    lines.push(`${LABELS[turn.role]}${turn.content}`);
  });
  flushGap();
  return `${lines.join("\n\n")}\n\n`;
}
