/** How capable a model a request needs, as JEV rates it (lowest first). */
export const AUTO_LEVELS = ["light", "standard", "heavy"] as const;
export type AutoLevel = (typeof AUTO_LEVELS)[number];

/** JEV confidence at or above which the `decide` tool acts on JEV's pick. */
export const DEFAULT_DECISION_CONFIDENCE = 0.6;
export const DECISION_CONFIDENCE_CHOICES = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9] as const;

export interface IntelligentModelSelectionSettings {
  enabled: boolean;
  /** OpenRouter Decisions API model ID, for example typesafe/jev-1.13 or ~typesafe/jev-latest. */
  jevModelId: string | null;
  /** The model each level runs on, as a `${providerId}:${modelId}` candidate
   * ID (reasoning-effort variants included). JEV only rates the request;
   * it never sees model names, so this mapping alone decides the model. */
  levelModels: Record<AutoLevel, string | null>;
  /** Experimental: JEV scores every tool call any model makes, without
   * enforcing its verdict, so its judgement can be compared with the model's. */
  decisionShadowEnabled: boolean;
  /** Experimental: offers agents the `decide` tool, so JEV picks between the
   * options an agent lays out instead of the agent choosing itself. */
  decisionToolEnabled: boolean;
  /** One of DECISION_CONFIDENCE_CHOICES, tuned against the decision calibration table. */
  decisionConfidenceThreshold: number;
  /** Experimental, enforced: JEV reviews risky actions (destructive writes and
   * commands) before they run, and can block them or ask the user. */
  riskReviewEnabled: boolean;
  /** Experimental: long chats are compacted with a JEV-assisted summary (JEV
   * rates which old messages matter, a model summarizes the rest) instead of
   * the default compaction, which trims old tool output and drops the oldest
   * turns without a model call. */
  smartContextCompactionEnabled: boolean;
}
