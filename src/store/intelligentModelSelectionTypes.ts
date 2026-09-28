/** How capable a model a request needs, as JEV rates it (lowest first). */
export const AUTO_LEVELS = ["light", "standard", "heavy"] as const;
export type AutoLevel = (typeof AUTO_LEVELS)[number];

export interface IntelligentModelSelectionSettings {
  enabled: boolean;
  /** OpenRouter Decisions API model ID, for example typesafe/jev-1.13 or ~typesafe/jev-latest. */
  jevModelId: string | null;
  /** The model each level runs on, as a `${providerId}:${modelId}` candidate
   * ID (reasoning-effort variants included). JEV only rates the request;
   * it never sees model names, so this mapping alone decides the model. */
  levelModels: Record<AutoLevel, string | null>;
}
