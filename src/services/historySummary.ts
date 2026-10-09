// ============================================================
// historySummary.ts — smart context compaction for a chat's earlier turns.
//
// rusty-core receives a chat's earlier turns folded into one prompt (see
// promptHistory.ts), so its own compaction cannot see them as messages. In
// smart mode the IDE keeps a running summary instead: after a run, once the
// history passes SOFT_LIMIT of its budget, JEV rates the older turns that are
// not yet accounted for, essential ones stay word for word, disposable ones
// are dropped, and the chat's own model folds the rest into the summary. The
// next run's prompt then carries the summary in their place. It never blocks
// a run: a failed or missing summary only means plain trimming.
// ============================================================

import { hybridControlPlane } from "../harness/HybridControlPlane";
import { flattenHistory, type HistorySummaryView } from "../harness/core/definitions/promptHistory";
import { RoutedSelectorModelInvoker, type SelectorModelInvoker } from "../harness/core/semanticRead/modelInvoker";
import type { TokenUsage } from "../harness/contract";
import { JEV_CONFIDENCE_THRESHOLD, postJevDecision } from "./intelligentModelSelector";
import type { AgentMessage, CustomProvider } from "../store/types";

export interface HistorySummary extends HistorySummaryView {
  /** Turns JEV rated essential: kept word for word and never summarized. */
  essentialIds: string[];
  updatedAt: string;
}

export interface HistoryTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  pinned?: boolean;
}

/** Summarize once the history (with the current summary) passes this share of its budget. */
export const SOFT_LIMIT = 0.7;
/** The newest turns are never summarized: the next request is about them. */
export const KEEP_RECENT_TURNS = 6;
/** Fewer new turns than this are not worth a model call yet. */
const MIN_CANDIDATES = 2;
const JUDGE_BATCH = 8;
const JUDGE_EXCERPT_CHARS = 600;
const SUMMARY_TURN_CHARS = 4_000;
const SUMMARY_INPUT_CHARS = 60_000;

const SUMMARY_SYSTEM_PROMPT =
  "You compress the earlier part of a conversation between a user and a coding assistant so work can continue from the summary alone. Merge the previous summary (if any) with the new turns into one updated summary. Preserve: the user's goals and constraints, decisions made and why, files created or changed, errors hit and how they were resolved, and open questions. Drop pleasantries and raw tool output; keep exact names, paths and numbers. Reply with the summary only, as terse bullet points.";

const JEV_INSTRUCTIONS =
  "How much does this earlier chat turn still matter for continuing the conversation? Choose the lowest level that is enough: anything needlessly kept as essential wastes context the assistant needs for the rest of the work.";
const JEV_CRITERIA = [
  "Essential: states a requirement, constraint, decision, plan or fact the remaining work depends on, and cannot be recovered from the project files.",
  "Useful: background worth one line in a summary, such as what was tried or what was found, but not needed word for word.",
  "Disposable: chatter, a dead end, or content that was superseded.",
] as const;
type Importance = "essential" | "useful" | "disposable";
const IMPORTANCE: Importance[] = ["essential", "useful", "disposable"];

/** The chat turns a run's prompt is built from: user and assistant messages,
 * a user message's attached context included, pins carried along. */
export function historyTurnsOf(messages: AgentMessage[]): HistoryTurn[] {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      id: message.id,
      role: message.role as "user" | "assistant",
      content: message.role === "user" && message.attachmentContext ? `${message.content}\n\n${message.attachmentContext}` : message.content,
      ...(message.pinned ? { pinned: true } : {}),
    }));
}

/** A summary read back from a saved chat, or `undefined` when it is missing or malformed. */
export function readHistorySummary(value: unknown): HistorySummary | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const ids = (key: string) => (Array.isArray(record[key]) ? (record[key] as unknown[]).filter((id): id is string => typeof id === "string") : []);
  if (typeof record.text !== "string") return undefined;
  return {
    text: record.text,
    summarizedIds: ids("summarizedIds"),
    droppedIds: ids("droppedIds"),
    essentialIds: ids("essentialIds"),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "",
  };
}

/** The turns the next pass would handle, or `undefined` when the history is
 * still comfortably within budget or too little is new. */
export function summaryCandidates(turns: HistoryTurn[], previous: HistorySummary | undefined, budgetChars: number): HistoryTurn[] | undefined {
  if (flattenHistory(turns, { summary: previous }).length <= budgetChars * SOFT_LIMIT) return undefined;
  const handled = new Set([...(previous?.summarizedIds ?? []), ...(previous?.droppedIds ?? []), ...(previous?.essentialIds ?? [])]);
  const end = Math.max(0, turns.length - KEEP_RECENT_TURNS);
  // The opening request and pinned turns always stay word for word.
  const candidates = turns.slice(1, end).filter((turn) => !turn.pinned && !handled.has(turn.id));
  return candidates.length >= MIN_CANDIDATES ? candidates : undefined;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}… [clipped]` : text;
}

function taskOf(turns: HistoryTurn[]): string {
  const users = turns.filter((turn) => turn.role === "user");
  const first = users[0]?.content ?? "";
  const last = users.length > 1 ? users[users.length - 1]!.content : "";
  return last
    ? `Original request:\n${clip(first, 2_000)}\n\nLatest request:\n${clip(last, 1_000)}`
    : `Request:\n${clip(first, 2_000)}`;
}

export interface JevConnection {
  apiKey: string;
  jevModelId: string;
  /** Below this confidence a rating steps up one level towards essential. */
  confidence?: number;
}

/** JEV's rating of each turn; turns it could not rate are left out (treated as useful). */
export async function judgeTurns(
  jev: JevConnection,
  task: string,
  turns: HistoryTurn[],
  signal: AbortSignal,
  post: typeof postJevDecision = postJevDecision,
): Promise<Map<string, Importance>> {
  const threshold = jev.confidence ?? JEV_CONFIDENCE_THRESHOLD;
  const verdicts = new Map<string, Importance>();
  for (let start = 0; start < turns.length; start += JUDGE_BATCH) {
    const batch = turns.slice(start, start + JUDGE_BATCH);
    const questions = Object.fromEntries(batch.map((turn, index) => [`m${index}`, {
      type: "score",
      instructions: `${JEV_INSTRUCTIONS}\n\n${turn.role === "user" ? "User" : "Assistant"} turn:\n${clip(turn.content, JUDGE_EXCERPT_CHARS)}`,
      criteria: JEV_CRITERIA,
    }]));
    const response = await post<{ answers?: Record<string, { confidence?: number; probabilities?: Record<string, number> }> }>(jev.apiKey, {
      model: jev.jevModelId,
      state: `A user and a coding assistant in a code editor have a long conversation whose earlier turns are about to be compressed. Current task:\n${task}\n\nEach question below is about one earlier turn.`,
      questions,
    }, signal);
    if (!response.ok || !response.result) continue;
    batch.forEach((turn, index) => {
      const answer = response.result?.answers?.[`m${index}`];
      if (typeof answer?.confidence !== "number" || !answer.probabilities) return;
      let best = -1;
      IMPORTANCE.forEach((_, position) => {
        const probability = answer.probabilities?.[String(position)];
        if (typeof probability !== "number") return;
        // Ties go to the more important level.
        if (best === -1 || probability > (answer.probabilities?.[String(best)] ?? -1)) best = position;
      });
      if (best === -1) return;
      // Unsure: lean towards keeping. Dropping something needed costs more.
      if (answer.confidence < threshold && best > 0) best -= 1;
      verdicts.set(turn.id, IMPORTANCE[best]!);
    });
  }
  return verdicts;
}

export interface RefreshHistorySummaryDeps {
  turns: HistoryTurn[];
  previous: HistorySummary | undefined;
  budgetChars: number;
  provider: CustomProvider;
  /** The chat's model reference, as a run is started with it. */
  model: string;
  jev: JevConnection;
  workspaceRoot: string;
  tabId: string;
  signal: AbortSignal;
  invoker?: SelectorModelInvoker;
  post?: typeof postJevDecision;
  recordUsage?: (usage: TokenUsage) => void;
}

/** One summary pass. Resolves to the new summary, or `undefined` when nothing
 * needed doing or the summary could not be produced (the previous one stays). */
export async function refreshHistorySummary(deps: RefreshHistorySummaryDeps): Promise<HistorySummary | undefined> {
  const candidates = summaryCandidates(deps.turns, deps.previous, deps.budgetChars);
  if (!candidates) return undefined;

  // A JEV failure only means every turn is treated as useful.
  const verdicts = await judgeTurns(deps.jev, taskOf(deps.turns), candidates, deps.signal, deps.post).catch(() => new Map<string, Importance>());
  const essential = candidates.filter((turn) => verdicts.get(turn.id) === "essential");
  const disposable = candidates.filter((turn) => verdicts.get(turn.id) === "disposable");
  const useful = candidates.filter((turn) => !essential.includes(turn) && !disposable.includes(turn));

  let text = deps.previous?.text ?? "";
  if (useful.length > 0) {
    const perTurn = Math.max(400, Math.min(SUMMARY_TURN_CHARS, Math.floor(SUMMARY_INPUT_CHARS / useful.length)));
    const transcript = useful.map((turn) => `[${turn.role === "user" ? "User" : "Assistant"}] ${clip(turn.content, perTurn)}`).join("\n\n");
    const invoker = deps.invoker ?? new RoutedSelectorModelInvoker();
    const record = deps.recordUsage ?? ((usage: TokenUsage) => {
      void hybridControlPlane.recordUsage({
        workspaceRoot: deps.workspaceRoot,
        surface: "agent_chat/history_summary",
        tabId: deps.tabId,
        provider: deps.provider.id,
        model: deps.model,
        usage: {
          input: usage.input ?? 0,
          output: usage.output ?? 0,
          cacheRead: usage.cacheRead ?? 0,
          cacheWrite: usage.cacheWrite ?? 0,
          reasoning: usage.reasoning,
          totalTokens: usage.totalTokens ?? ((usage.input ?? 0) + (usage.output ?? 0)),
        },
      }).catch(() => {});
    });
    const summary = (await invoker.invoke({
      providerId: deps.provider.id,
      modelId: deps.model,
      provider: deps.provider,
      systemPrompt: SUMMARY_SYSTEM_PROMPT,
      userPrompt: `Previous summary:\n${text || "(none)"}\n\nNew turns to fold in:\n${transcript}`,
      signal: deps.signal,
      workspaceRoot: deps.workspaceRoot,
      onUsage: record,
    }).catch(() => "")).trim();
    if (!summary) return undefined;
    text = summary;
  }

  return {
    text,
    summarizedIds: [...(deps.previous?.summarizedIds ?? []), ...useful.map((turn) => turn.id)],
    droppedIds: [...(deps.previous?.droppedIds ?? []), ...disposable.map((turn) => turn.id)],
    essentialIds: [...(deps.previous?.essentialIds ?? []), ...essential.map((turn) => turn.id)],
    updatedAt: new Date().toISOString(),
  };
}
