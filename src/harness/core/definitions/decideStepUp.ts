import type { CustomProvider } from "../../../store/types";
import { AUTO_LEVELS, type AutoLevel } from "../../../store/intelligentModelSelectionTypes";
import { AUTO_LEVEL_CRITERIA, AUTO_LEVEL_LABELS, type JevScoreAnswer } from "../../../services/intelligentModelSelector";
import { mapProviderToIntegration } from "../providerMapping";
import type { ExecutionParams } from "../SessionRecipe";
import type { DecideStepUpConfig } from "../decideToolConfig";

/** A more capable AUTO level the running session can switch to. */
export interface StepUpTarget {
  level: AutoLevel;
  name: string;
  /** The model reference, as `input.model` would carry it. */
  model: string;
  /** The `configure_execution` update that switches the session to it. */
  params: ExecutionParams;
}

const levelIndex = (level: AutoLevel) => AUTO_LEVELS.indexOf(level);

/**
 * The levels above `currentLevel` whose model the session can switch to in
 * place: a session keeps its provider and core integration (whose config
 * carries the credentials), so only models that map to the same ones
 * qualify. Managed transports run the model inside their own CLI and are
 * never switched. A model that would silently inherit the current model's
 * reasoning effort (params updates cannot clear a field) is skipped too.
 */
export function stepUpTargets(
  config: DecideStepUpConfig,
  currentLevel: AutoLevel,
  provider: CustomProvider | undefined,
  currentModel: string,
): StepUpTarget[] {
  if (!provider || (provider.transport && provider.transport !== "http")) return [];
  const current = mapProviderToIntegration(provider, currentModel);
  if (!current.supported) return [];
  const targets: StepUpTarget[] = [];
  for (const level of AUTO_LEVELS.slice(levelIndex(currentLevel) + 1)) {
    const candidate = config.levels[level];
    if (!candidate || candidate.providerId !== provider.id || candidate.model === currentModel) continue;
    const mapped = mapProviderToIntegration(provider, candidate.model);
    if (!mapped.supported || mapped.integration !== current.integration) continue;
    if (JSON.stringify(mapped.integration_config ?? null) !== JSON.stringify(current.integration_config ?? null)) continue;
    if (current.reasoningEffort && !mapped.reasoningEffort) continue;
    targets.push({
      level,
      name: candidate.name,
      model: candidate.model,
      params: {
        model: mapped.model ?? candidate.model,
        ...(mapped.reasoningEffort ? { reasoning_effort: mapped.reasoningEffort } : {}),
      },
    });
  }
  return targets;
}

const LEVEL_INSTRUCTIONS =
  "Given what the agent has done so far and the decision it now faces, how capable must the AI model be to complete the rest of this request well? Choose the lowest level that is enough: more capable models are slower and more expensive, so a stronger model than needed is a worse answer.";

/** AUTO's own difficulty rubric, asked about the remaining work. */
export function levelQuestion() {
  return {
    type: "score",
    instructions: LEVEL_INSTRUCTIONS,
    criteria: AUTO_LEVELS.map((level) => `${AUTO_LEVEL_LABELS[level]}: ${AUTO_LEVEL_CRITERIA[level]}`),
  };
}

export interface LevelAssessment {
  /** JEV's most likely level for the remaining work. */
  level: AutoLevel;
  confidence: number;
  /** Set when the run should switch: the most capable target at or below `level`. */
  target?: StepUpTarget;
}

/**
 * Steps up only when JEV is confident the remaining work needs a higher
 * level than the run has now. Unlike AUTO's start-of-run choice, an unsure
 * answer never steps up: this is asked on every decision, and a switch
 * mid-run cannot be undone.
 */
export function assessLevel(
  answer: JevScoreAnswer | undefined,
  currentLevel: AutoLevel,
  targets: StepUpTarget[],
  minConfidence: number,
): LevelAssessment | undefined {
  if (answer?.type !== "score" || typeof answer.confidence !== "number") return undefined;
  const ranked = AUTO_LEVELS
    .map((level, index) => ({ level, probability: answer.probabilities?.[String(index)] }))
    .filter((entry): entry is { level: AutoLevel; probability: number } => typeof entry.probability === "number")
    .sort((a, b) => b.probability - a.probability || levelIndex(b.level) - levelIndex(a.level));
  if (ranked.length === 0) return undefined;
  const level = ranked[0].level;
  const assessment: LevelAssessment = { level, confidence: answer.confidence };
  if (answer.confidence < minConfidence || levelIndex(level) <= levelIndex(currentLevel)) return assessment;
  assessment.target = targets.filter((target) => levelIndex(target.level) <= levelIndex(level)).at(-1);
  return assessment;
}
