/**
 * Known violations of the rules in boundaries.test.ts. An entry stays only while its file still
 * breaks its rule: the test fails on a listed file that is fixed, so these lists only shrink.
 * Paths are relative to src/.
 */

/** B1: files outside harness/ that call Tauri directly and are not named client.ts. */
export const TAURI_OUTSIDE_CLIENT: readonly string[] = [
];

/** B2: features that import another feature's internals instead of its index.ts. */
export const CROSS_FEATURE_DEEP_IMPORT: readonly string[] = [
];

/** B3: lib/ importing upward, harness/ importing views or feature internals, and feature state.ts files importing the composed store. */
export const LAYERING: readonly string[] = [
];

/** B4: React code or .tsx files outside a feature's ui/ folder. */
export const REACT_OUTSIDE_UI: readonly string[] = [
];

/** B5: files over their size limit (300 lines for .tsx, 400 for .ts), with the line count they had when listed. */
export const OVERSIZED: ReadonlyArray<readonly [string, number]> = [
  ["harness/core/CoreHarness.ts", 431],
  ["harness/core/definitions/agent_chat.ts", 751],
  ["harness/core/definitions/decideTool.ts", 465],
  ["harness/core/definitions/exploreTools.ts", 608],
  ["harness/core/definitions/reconciliate_graph.ts", 448],
  ["harness/core/definitions/webSearch.ts", 749],
  ["harness/core/projectInfo.ts", 817],
  ["harness/core/run/CoreRun.ts", 474],
  ["harness/core/workflowRun.ts", 436],
  ["store/types.ts", 737],
  ["theme.ts", 575],
];
