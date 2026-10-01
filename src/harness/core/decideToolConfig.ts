import type { AutoLevel } from "../../store/intelligentModelSelectionTypes";

/** The model-facing name of the JEV decision tool. rusty-core allows it
 * under every execution policy (`execution_policy::allows_tool`). */
export const DECIDE_TOOL_NAME = "decide";

/** Where the run's `decide` calls reach JEV, captured by whoever starts the
 * run (never read from the store by harness code). Absent when the tool is
 * off or OpenRouter/JEV is unavailable: the tool is then not offered. */
export interface DecideToolRunConfig {
  apiKey: string;
  jevModelId: string;
  /** JEV confidence at or above which its pick is acted on; defaults to
   * `JEV_CONFIDENCE_THRESHOLD`. */
  proceedConfidence?: number;
  /** Present when AUTO chose the run's model: lets `decide` step the run up
   * to a more capable level's model mid-run. */
  stepUp?: DecideStepUpConfig;
}

/** One AUTO level's model, as the Settings mapping resolved it at run start. */
export interface StepUpLevelModel {
  providerId: string;
  /** The model reference the run would be started with (`input.model`). */
  model: string;
  /** Display name, for the run's log. */
  name: string;
}

export interface DecideStepUpConfig {
  /** The level AUTO sized the run at. */
  level: AutoLevel;
  levels: Partial<Record<AutoLevel, StepUpLevelModel>>;
}

/** Where a workflow run's per-step AUTO selection reaches JEV. Present only
 * for an AUTO run of a workflow: before each agent step's first model turn
 * JEV rates that step on its own, and the step runs on the matching level's
 * model (see stepModelSelection.ts). */
export interface StepModelRunConfig {
  apiKey: string;
  jevModelId: string;
  /** The Settings level-to-model mapping, as resolved when the run started. */
  levels: Partial<Record<AutoLevel, StepUpLevelModel>>;
}

/** Where the flow router reaches JEV: choosing a workflow for a message, and
 * deciding at a step boundary whether a running workflow should hand over. */
export interface FlowRouterRunConfig {
  apiKey: string;
  jevModelId: string;
  /** JEV confidence at or above which its pick is acted on; defaults to
   * `JEV_CONFIDENCE_THRESHOLD`. */
  proceedConfidence?: number;
}

/** A workflow a running one may hand over to. */
export interface FlowSwitchTarget {
  /** The workflow's id without the built-in namespace. */
  id: string;
  /** Where the IDE reads it from (a path, or `builtin:<id>`). */
  path: string;
  name: string;
  /** When it applies, as the router is asked it. */
  when: string;
  /** Whether it can change files: a hand-over to one asks the user first. */
  edits: boolean;
}

/** Everything a workflow run needs to hand over at a step boundary. Present
 * only when the chat allows flow switching and the workflow declares targets. */
export interface FlowSwitchingRunConfig {
  router: FlowRouterRunConfig;
  /** The running workflow's display name. */
  workflowName: string;
  targets: FlowSwitchTarget[];
}

/** Where the run's risky-action reviews reach JEV; absent when reviews are
 * off or OpenRouter/JEV is unavailable. */
export interface JevRiskReviewRunConfig {
  apiKey: string;
  jevModelId: string;
  /** JEV confidence at or above which a Proceed verdict lets the action run
   * without asking the user; defaults to `JEV_CONFIDENCE_THRESHOLD`. */
  proceedConfidence?: number;
}

declare module "../contract/capabilities" {
  interface AgentChatInput {
    jevDecisionTool?: DecideToolRunConfig;
    jevRiskReview?: JevRiskReviewRunConfig;
    autoStepModels?: StepModelRunConfig;
    flowSwitching?: FlowSwitchingRunConfig;
  }
  interface ExecuteNodeInput {
    jevDecisionTool?: DecideToolRunConfig;
    jevRiskReview?: JevRiskReviewRunConfig;
  }
}
