// ============================================================
// tokenOptimizations -- everything Rusty does to send models fewer
// tokens, in one place. README.md next to this file explains each
// optimisation for people using Rusty and for people changing it.
//
// THE ONLY PUBLIC SURFACE. Code outside this folder imports from here and
// nowhere else; tokenOptimizations.boundary.test.ts enforces it.
//
//   What there is        TOKEN_OPTIMIZATIONS, SAFEGUARDS (catalog.ts)
//   On or off            isOptimizationEnabled / setOptimizationEnabled /
//                        subscribeToOptimizationSwitches (switches.ts)
//   What they did        tokenOptimizationStats / recallRate /
//                        resetTokenOptimizationStats / subscribe... (stats.ts)
//
//   Command output       createCommandOutputCondenser() -> CommandOutputCondenser
//     (condense, recall)   .condense(run)   a finished command's output, ready
//                                           for the model: condensed, kept for
//                                           recall, fitted, stamped
//                          .shape(input)    the shaping alone, for a tail
//                          .owns / .recall  the full output back by its id
//   Chat history         chooseHistoryTurns(turns, budget, plainSelection)
//   Model switches       checkModelSwitch(change) -> { allowed, reason }
//   Agent tool results   createToolOutputOptimizer().wrap(tool, handler, chat?): repeats
//                        become pointers, re-reads of changed files the change,
//                        very large reports are cut; with chat, calls are noted
//   Across chat turns    workingSetFor(chat): the next turn's "Working set" section
//   Edit results         describeEdit(before, after): the lines an edit left
//   Prompt cache         createPromptCacheWatch(): one per run; feed it usage
//                        and prefix changes, it counts hits and misses
//
// Inside, one folder per concern; each is replaceable behind the
// functions above:
//   commandOutput/  filters per command family, the generic layer, the condenser
//   recall/         content ids, the RecallStore seam, reading back
//   history/        stepped turn selection
//   modelSwitch/    the warm-cache rule
//   toolOutput/     repeat pointers and size limits for the agent's own tools
//   fileState/      changed regions: what an edit left, what changed since a read
//   workingSet/     what a chat already explored, for its next turns
//   safeguards/     never worse, fail open, stamps
//   promptCache/    judging each request's cache use (measures only)
// ============================================================

import { Condenser, type CondenserDeps } from "./commandOutput/condenser";
import { ToolOutputOptimizer } from "./toolOutput/optimizer";
import type { CommandOutputCondenser } from "./commandOutput/types";

export { TOKEN_OPTIMIZATIONS, SAFEGUARDS, optimizationById, type OptimizationId, type Safeguard, type TokenOptimization } from "./catalog";
export { isOptimizationEnabled, optimizationSwitches, setOptimizationEnabled, subscribeToOptimizationSwitches } from "./switches";
export {
  cacheHitRate,
  recallRate,
  resetTokenOptimizationStats,
  subscribeToTokenOptimizationStats,
  tokenOptimizationStats,
  type FilterStats,
  type PromptCacheStats,
  type TokenOptimizationStats,
} from "./stats";

export type { CommandOutputCondenser, CommandRun, Condensed, RecallQuery, Recalled, ShapeInput } from "./commandOutput/types";
export { OUTPUT_LIMITS, TRUNCATION_MARKER } from "./commandOutput/condenser";
export { MemoryRecallStore, type RecallStore } from "./recall/store";
export { parseStamps, type Stamp } from "./safeguards/stamps";
export { chooseHistoryTurns, type HistoryTurn, type TurnSelection } from "./history";
export { checkModelSwitch, estimateConversationTokens, type ModelSwitch, type ModelSwitchVerdict } from "./modelSwitch";
export { ToolOutputOptimizer, TOOL_OUTPUT_LIMITS } from "./toolOutput/optimizer";
export { describeEdit } from "./fileState/region";
export { createPromptCacheWatch, PromptCacheWatch, type CachedRequest, type MissCause } from "./promptCache";
export { forgetWorkingSet, noteToolUse, workingSetFor, WORKING_SET_LIMITS } from "./workingSet";

/** Wraps the agent's own tools (read_file, spec_context, repo_context...) so their results cost less; one per run. */
export function createToolOutputOptimizer(): ToolOutputOptimizer {
  return new ToolOutputOptimizer();
}

/**
 * A command-output condenser. With no argument it uses the app's switches,
 * its session recall store and its statistics; pass parts to replace them
 * (a test's own store, a host without statistics).
 */
export function createCommandOutputCondenser(deps: Partial<CondenserDeps> = {}): CommandOutputCondenser {
  return new Condenser(deps);
}
