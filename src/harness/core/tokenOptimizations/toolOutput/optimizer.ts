// ============================================================
// toolOutput/optimizer.ts -- the agent's own tools (read_file,
// spec_context, repo_context, ...) wrapped so their results cost less:
//
//   repeat-results      a part the same agent session already received,
//                       unchanged, becomes a one-line pointer (with a recall
//                       id, in case in-run compaction shortened the copy)
//   tool-output-limits  a very large result of a reporting tool keeps its
//                       head and tail, stamped, with the full text recallable
//
// Applied when the tool returns, before the result enters the conversation,
// so nothing already sent ever changes. Memory is per agent session: a
// workflow step or sub-agent starts with its own conversation, so what
// another session received does not count.
// ============================================================

import type { OptimizationId } from "../catalog";
import { contentId } from "../recall/contentId";
import { sessionRecallStore, type RecallStore } from "../recall/store";
import { failOpen, neverWorse } from "../safeguards/guards";
import { hasStamp, renderStamp } from "../safeguards/stamps";
import { recordCondensed } from "../stats";
import { isOptimizationEnabled } from "../switches";
import { changeSinceLastRead } from "../fileState/rereads";
import { noteToolUse } from "../workingSet";
import { sectionsOf } from "./sections";

export const TOOL_OUTPUT_LIMITS = {
  /** A part shorter than this is resent rather than pointed at: the pointer would save little. */
  repeatFromChars: 400,
  /** File texts remembered across all sessions of a run, so a re-read can be answered with its change. */
  maxRememberedChars: 8_000_000,
  /** Results of the limited tools above this many characters are cut... */
  maxChars: 12_000,
  /** ...to this head... */
  headChars: 9_000,
  /** ...and this tail. */
  tailChars: 2_000,
} as const;

/** Reporting tools whose results are cut when very large. Files and specs are never cut. */
export const LIMITED_TOOLS = ["repo_context", "project_info", "code_guidelines", "search_codebase", "repo_symbol", "repo_overview", "repo_health", "repo_risk", "list_files"];
/** Tools whose repeated results are pointed at. */
export const REPEAT_TOOLS = ["read_file", "spec_context", "repo_context", "project_info", "code_guidelines", "repo_symbol", "repo_overview", "repo_health", "repo_risk", "search_codebase", "list_files"];

/** Tools whose calls say where things are, for a chat's working set. */
const WORKING_SET_TOOLS = ["read_file", "edit_file", "write_file", "search_codebase", "repo_symbol", "repo_context"];

export type ToolOutcomeLike = { ok: true; output: unknown } | { ok: false; error: unknown };
export interface ToolCallLike {
  sessionId?: string;
}
export type ToolHandlerLike = (args: unknown, signal: AbortSignal, observer?: never, call?: ToolCallLike) => Promise<ToolOutcomeLike>;

export interface ToolOutputDeps {
  store: RecallStore;
  isEnabled: (id: OptimizationId) => boolean;
  onCondensed: (filter: string, rawChars: number, shownChars: number, stored: boolean) => void;
}

const appDeps: ToolOutputDeps = { store: sessionRecallStore, isEnabled: isOptimizationEnabled, onCondensed: recordCondensed };

const pointer = (id: string) => `[unchanged since this session last received it: it is still in your context above, or read it again with job_output id="${id}"]`;

/** Cuts `text` at line boundaries to its head and tail. */
function headAndTail(text: string): { text: string; hidden: number } {
  const head = text.slice(0, TOOL_OUTPUT_LIMITS.headChars);
  const headEnd = head.lastIndexOf("\n") > 0 ? head.lastIndexOf("\n") : head.length;
  const tail = text.slice(-TOOL_OUTPUT_LIMITS.tailChars);
  const tailStart = tail.indexOf("\n") >= 0 ? tail.indexOf("\n") + 1 : 0;
  const kept = `${text.slice(0, headEnd)}\n[... ${(text.length - headEnd - (tail.length - tailStart)).toLocaleString("en-US")} chars left out ...]\n${tail.slice(tailStart)}`;
  return { text: kept, hidden: text.length - kept.length };
}

export class ToolOutputOptimizer {
  private readonly deps: ToolOutputDeps;
  /** Per agent session and section: the content id it last received, and for file reads the text. */
  private readonly sent = new Map<string, { id: string; text?: string }>();
  private keptChars = 0;

  constructor(deps: Partial<ToolOutputDeps> = {}) {
    this.deps = { ...appDeps, ...deps };
  }

  /**
   * `handler` with its results optimised; any other tool is returned unchanged.
   * With `chat`, successful calls also go into that chat's working set for its next turns.
   */
  wrap<H extends (...args: never[]) => Promise<unknown>>(tool: string, handler: H, chat?: string): H {
    const noted = Boolean(chat) && WORKING_SET_TOOLS.includes(tool);
    if (!REPEAT_TOOLS.includes(tool) && !LIMITED_TOOLS.includes(tool) && !noted) return handler;
    const inner = handler as unknown as ToolHandlerLike;
    const wrapped: ToolHandlerLike = async (args, signal, observer, call) => {
      const outcome = await inner(args, signal, observer, call);
      if (outcome.ok && noted) noteToolUse(chat!, tool, args);
      if (!outcome.ok || typeof outcome.output !== "string" || hasStamp(outcome.output)) return outcome;
      const output = outcome.output;
      return { ok: true, output: failOpen(() => this.optimize(tool, output, args, call?.sessionId ?? ""), output) };
    };
    return wrapped as unknown as H;
  }

  optimize(tool: string, output: string, args: unknown, session: string): string {
    let text = output;
    if (REPEAT_TOOLS.includes(tool) && this.deps.isEnabled("repeat-results")) text = this.pointAtRepeats(tool, text, args, session);
    if (LIMITED_TOOLS.includes(tool) && this.deps.isEnabled("tool-output-limits") && text.length > TOOL_OUTPUT_LIMITS.maxChars) text = this.limit(tool, text);
    return neverWorse(output, text).text;
  }

  /** Remembers what `key` last sent; file reads keep their text (bounded) so a later read can be answered with the change. */
  private remember(key: string, id: string, text: string | undefined): void {
    const old = this.sent.get(key);
    if (old?.text) this.keptChars -= old.text.length;
    this.sent.delete(key);
    this.sent.set(key, { id, text });
    if (text) this.keptChars += text.length;
    for (const [oldest, entry] of this.sent) {
      if (this.keptChars <= TOOL_OUTPUT_LIMITS.maxRememberedChars) break;
      if (entry.text) this.keptChars -= entry.text.length;
      this.sent.delete(oldest);
    }
  }

  private pointAtRepeats(tool: string, output: string, args: unknown, session: string): string {
    let saved = 0;
    const parts = sectionsOf(tool, output, args).map((section) => {
      const key = `${session}|${tool}|${section.key}`;
      const id = contentId(section.text);
      const before = this.sent.get(key);
      const repeated = before?.id === id && !section.alwaysSend && section.text.length >= TOOL_OUTPUT_LIMITS.repeatFromChars;
      this.remember(key, id, tool === "read_file" ? section.text : undefined);
      if (!repeated && before?.text && tool === "read_file") {
        // Read again after it changed (usually by this session's own edit): send only what changed.
        const recallId = this.deps.store.put({ label: `${tool} (changed)`, source: `changed ${tool}`, text: section.text });
        const change = changeSinceLastRead(before.text, section.text, recallId);
        if (change && change.length < section.text.length) {
          saved += section.text.length - change.length;
          return change;
        }
      }
      if (!repeated) return section.text;
      this.deps.store.put({ label: `${tool} (repeat)`, source: `repeat ${tool}`, text: section.text });
      const heading = tool === "spec_context" ? `${section.text.split("\n")[0]}\n\n` : "";
      const replaced = `${heading}${pointer(id)}`;
      saved += section.text.length - replaced.length;
      return replaced;
    });
    if (saved <= 0) return output;
    const text = parts.join("\n");
    this.deps.onCondensed(`repeat ${tool}`, output.length, text.length, true);
    return text;
  }

  private limit(tool: string, output: string): string {
    const recallId = this.deps.store.put({ label: tool, source: `limit ${tool}`, text: output });
    const cut = headAndTail(output);
    const stamp = renderStamp({ action: "condensed", method: tool, rawChars: output.length, shownChars: cut.text.length, recallId });
    const text = `${cut.text}\n${stamp}`;
    this.deps.onCondensed(`limit ${tool}`, output.length, text.length, true);
    return text;
  }
}
