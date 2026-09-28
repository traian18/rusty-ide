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
  }
  interface ExecuteNodeInput {
    jevDecisionTool?: DecideToolRunConfig;
    jevRiskReview?: JevRiskReviewRunConfig;
  }
}
