import type { DecideStepUpConfig } from "../../../harness/core/decideToolConfig";
import { executionObservability } from "../../../observability/executionStore";
import { jevSelectionRecord } from "../../../observability/modelSelectionRecord";
import { snapshotStepModels } from "../../../services/jevDecisionToolSnapshot";
import {
  AUTO_LEVEL_LABELS,
  AUTO_MODEL_ID,
  findOpenRouterJevProvider,
  IntelligentModelSelectionError,
  resolveLevelCandidates,
  selectIntelligentModel,
  type LevelCandidates,
} from "../../../services/intelligentModelSelector";
import { useWorkspaceStore } from "../../../store";
import { abandonTurn, type AgentTurn } from "./turn";

/** The model a run starts on, and with AUTO how JEV may move it later. */
export interface RunModel {
  modelId: string;
  /** With AUTO, JEV decisions can later step the run up to a higher level's model. */
  autoStepUp?: DecideStepUpConfig;
  /** With AUTO on a workflow, each agent step picks its own model (see
   * stepModelSelection.ts) instead of the whole message being rated once. */
  autoStepModels?: ReturnType<typeof snapshotStepModels>;
}

type Levels = DecideStepUpConfig["levels"];

/** Steps start on the Standard level's model and move to the level JEV rates
 * them at, just before their first model turn. */
function workflowStepModels(turn: AgentTurn, candidates: LevelCandidates, levels: Levels): RunModel {
  const autoStepModels = snapshotStepModels(useWorkspaceStore.getState(), levels);
  if (!autoStepModels) throw new IntelligentModelSelectionError("OpenRouter JEV is not available for choosing each step's model.");
  turn.ui.setStreamingLabel("Choosing a model for each step…");
  return { modelId: candidates.standard.model.id, autoStepUp: { level: "standard", levels }, autoStepModels };
}

/** A single agent's message is rated once, up front. */
async function ratedModel(
  turn: AgentTurn,
  message: string,
  jevProvider: NonNullable<ReturnType<typeof findOpenRouterJevProvider>>,
  candidates: LevelCandidates,
  levels: Levels,
): Promise<RunModel> {
  const { jevModelId } = turn.intelligentModelSelectionSettings;
  const workspaceRoot = useWorkspaceStore.getState().rootPath || undefined;
  const selection = await selectIntelligentModel(message, jevProvider, candidates, jevModelId, (trace) =>
    executionObservability.recordStandalone(jevSelectionRecord(trace, { tabId: turn.chatId, workspaceRoot })),
  );
  const confidence = (selection.confidence * 100).toFixed(0);
  turn.ui.setStreamingLabel(`${AUTO_LEVEL_LABELS[selection.level]} task${selection.escalated ? " (stepped up)" : ""} · ${selection.candidate.model.name} (${confidence}% confidence)…`);
  return { modelId: selection.candidate.model.id, autoStepUp: { level: selection.level, levels } };
}

function levelCandidates(turn: AgentTurn): { candidates: LevelCandidates; levels: Levels } {
  const state = useWorkspaceStore.getState();
  const { candidates, missing } = resolveLevelCandidates(
    state.customProviders,
    state.providerStatus,
    state.activeCustomProviderId,
    turn.intelligentModelSelectionSettings.levelModels,
  );
  if (missing.length > 0) {
    throw new IntelligentModelSelectionError(
      `No available model is set for ${missing.map((level) => AUTO_LEVEL_LABELS[level]).join(", ")}. Choose one in Settings → Intelligence.`,
    );
  }
  const levelCandidates = candidates as LevelCandidates;
  const levels = Object.fromEntries(Object.entries(levelCandidates).map(([level, candidate]) => [
    level,
    { providerId: candidate.provider.id, model: candidate.model.id, name: candidate.model.name },
  ])) as Levels;
  return { candidates: levelCandidates, levels };
}

/** Resolves AUTO to a concrete model before the run starts; any other choice
 * is used as it is. Undefined when AUTO cannot choose: the turn has ended,
 * with the reason in the chat. */
export async function resolveRunModel(turn: AgentTurn, workflow: boolean, message: string): Promise<RunModel | undefined> {
  if (turn.selectedModel !== AUTO_MODEL_ID) return { modelId: turn.selectedModel };
  turn.ui.setStreamingLabel("Selecting the best model…");
  const jevProvider = findOpenRouterJevProvider(useWorkspaceStore.getState().customProviders, turn.intelligentModelSelectionSettings.jevModelId);
  if (!jevProvider) {
    abandonTurn(turn, "OpenRouter JEV provider not available for intelligent model selection.", "Model Selection Failed", "OpenRouter provider is not configured.");
    return undefined;
  }
  try {
    const { candidates, levels } = levelCandidates(turn);
    return workflow ? workflowStepModels(turn, candidates, levels) : await ratedModel(turn, message, jevProvider, candidates, levels);
  } catch (error) {
    const errorMessage = error instanceof IntelligentModelSelectionError
      ? error.message
      : "An unexpected error occurred during model selection.";
    abandonTurn(turn, `Model selection error: ${errorMessage}\n\nPlease select a model manually.`, "Model Selection Failed", errorMessage);
    return undefined;
  }
}
