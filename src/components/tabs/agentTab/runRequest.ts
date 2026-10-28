import { invoke } from "@tauri-apps/api/core";
import type { AgentChatInput } from "../../../harness/contract";
import type { ContextCompactionRunConfig } from "../../../harness/core/decideToolConfig";
import { refreshTree } from "../../filetree/FileTreePresenter";
import { conversationResults, withConversation, workflowInputFor, workflowUsesContext } from "../../../harness/core/workflowRun";
import { repositoryContextInput } from "../../../services/repositoryContextInput";
import { snapshotFlowRouter, snapshotJevDecisionTool, snapshotJevRiskReview } from "../../../services/jevDecisionToolSnapshot";
import { snapshotSmartToolSettings } from "../../../store/smartToolSettingsSnapshot";
import { resolveSkill, toSkillData, BUILT_IN_SKILL_IDS } from "../../../config/skillDefinitions";
import { useWorkspaceStore, type AgentMessage } from "../../../store";
import type { WorkflowChoice } from "../behaviors/AgentWorkflowBar";
import type { JsonObject } from "../behaviors/behaviorModel";
import { workflowSwitchTargets } from "../behaviors/flowCatalog";
import type { SpecRun } from "../../../specs/run";
import type { RunModel } from "./runModel";
import type { AgentTurn } from "./turn";
import type { GoalPass } from "./goalTurn";

/** The message a turn sends. */
export interface TurnMessage {
  /** The user's message in the chat. */
  id: string;
  /** What the user wrote. */
  text: string;
  /** What the model is sent: the text and the attached context. */
  toSend: string;
}

/** What one run of a turn is started from. A workflow that hands over starts the next run from this. */
export interface LaunchPlan {
  workflowDefinition: Record<string, unknown> | undefined;
  workflowId: string;
  /** What the run starts from when a previous run handed over (else the chat's last result). */
  context?: string;
  /** Hand-overs still allowed in this turn. */
  switchesLeft: number;
  /** Workflows already run in this turn (by short id): none is run twice. */
  visited: string[];
  /** A Specify or Plan run: its finished steps are written into the change folder. */
  spec?: SpecRun;
  /** Extra run inputs a workflow binds (an Implement run's task plans). */
  inputs?: Record<string, unknown>;
  /** The run is a pass of a goal: when it ends, the goal is measured and may go on. */
  goal?: GoalPass;
}

/** How a workflow is named to the routers. */
export function flowCandidateName(option: WorkflowChoice): string {
  return `${option.kind === "stage" ? "Stage" : "Workflow"}: ${option.name}`;
}

/** The type of each step of `definition`, by node id. */
export function workflowStepTypesOf(definition: Record<string, unknown> | undefined): Record<string, string> {
  const nodes = Array.isArray(definition?.nodes) ? (definition.nodes as Array<{ id?: unknown; type?: unknown }>) : [];
  return Object.fromEntries(nodes.map((node) => [String(node.id), String(node.type)]));
}

/** Whether this run may hand over to another workflow at a step boundary, and to which. */
function flowSwitchingFor(turn: AgentTurn, plan: LaunchPlan): AgentChatInput["flowSwitching"] {
  const { workflowDefinition } = plan;
  if (!turn.state.flowSwitching || !workflowDefinition || plan.switchesLeft <= 0) return undefined;
  const router = snapshotFlowRouter(useWorkspaceStore.getState());
  if (!router) return undefined;
  const targets = workflowSwitchTargets(workflowDefinition as JsonObject)
    .map((id) => turn.state.workflowOptions.find((option) => option.id === id))
    .filter((option): option is WorkflowChoice & { id: string } => Boolean(option?.id) && !plan.visited.includes(option!.id!))
    .map((option) => ({
      id: option.id,
      path: option.path,
      name: flowCandidateName(option),
      when: option.route ?? option.description ?? option.name,
      edits: Boolean(option.edits),
    }));
  if (targets.length === 0) return undefined;
  return { router, workflowName: String(workflowDefinition.name ?? plan.workflowId), targets };
}

/** The conversation before this message, as the run is given it. */
function runChatHistory(chatHistory: AgentMessage[], message: TurnMessage): AgentChatInput["chatHistory"] {
  return chatHistory
    .filter((m) => m.id !== message.id && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({
      role: m.role,
      content: m.role === "user" && m.attachmentContext ? `${m.content}\n\n${m.attachmentContext}` : m.content,
      ...(m.pinned ? { pinned: true } : {}),
      id: m.id,
    }));
}

/** What the workflow starts from. A stage picks up the result the previous
 * run left in this chat, or the work a workflow finished before it handed
 * over. A workflow that reads `/context` is given the earlier result there.
 * One that only reads the request would otherwise see a bare follow-up and
 * start from nothing, so the conversation goes behind its request. */
function workflowRunInput(definition: Record<string, unknown>, message: TurnMessage, chatHistory: AgentMessage[], plan: LaunchPlan) {
  const structured = Boolean(definition.input_schema);
  if (plan.inputs) return { ...(workflowInputFor(message.toSend, structured, plan.context ?? "") as object), ...plan.inputs };
  if (workflowUsesContext(definition)) {
    return workflowInputFor(message.toSend, structured, plan.context ?? conversationResults(chatHistory), chatHistory);
  }
  const request = structured
    ? message.toSend
    : withConversation(message.toSend, chatHistory.filter((m) => m.id !== message.id), plan.context);
  return workflowInputFor(request, structured);
}

function workflowRun(turn: AgentTurn, message: TurnMessage, chatHistory: AgentMessage[], plan: LaunchPlan): AgentChatInput["workflow"] {
  if (!plan.workflowDefinition) return undefined;
  return {
    definition: plan.workflowDefinition,
    input: workflowRunInput(plan.workflowDefinition, message, chatHistory, plan),
    checkpoint: turn.state.workflowCheckpoint,
    options: { autoApprove: turn.state.autoApprove },
  };
}

/** The parts of the input that only some runs carry. */
function optionalInputs(turn: AgentTurn, model: RunModel, plan: LaunchPlan, compaction: ContextCompactionRunConfig): Partial<AgentChatInput> {
  const flowSwitching = flowSwitchingFor(turn, plan);
  // With JEV available, a step whose hand-off is long gets only the parts it needs.
  const handoffCuration = plan.workflowDefinition ? snapshotFlowRouter(useWorkspaceStore.getState()) : undefined;
  return {
    ...(compaction.mode === "smart" && turn.state.historySummary ? { historySummary: turn.state.historySummary } : {}),
    ...(model.autoStepModels ? { autoStepModels: model.autoStepModels } : {}),
    ...(flowSwitching ? { flowSwitching } : {}),
    ...(plan.workflowDefinition && handoffCuration ? { handoffCuration } : {}),
  };
}

/** The `agent_chat` input for one run of the turn. */
export function agentChatInput(
  turn: AgentTurn,
  message: TurnMessage,
  model: RunModel,
  provider: unknown,
  plan: LaunchPlan,
  contextCompaction: ContextCompactionRunConfig,
): AgentChatInput {
  const state = useWorkspaceStore.getState();
  const chatHistory = state.agentChats[turn.chatId] || [];
  const skillData = toSkillData(resolveSkill(state.skills, plan.workflowDefinition ? BUILT_IN_SKILL_IDS.BUILD : turn.selectedSkillId));
  return {
    tabId: turn.chatId,
    message: message.toSend,
    model: model.modelId,
    workspaceRoot: state.rootPath,
    chatHistory: runChatHistory(chatHistory, message),
    customProvider: provider,
    skill: skillData,
    skillId: skillData?.skillId,
    repositoryContext: repositoryContextInput(state, state.rootPath, skillData?.skillId),
    // Offer every connected server; the session's execution policy decides
    // which ones the active skill actually gets (skillExecutionPolicy.ts).
    mcpServers: Object.values(state.mcpServers).filter((server) => server.enabled),
    webSearchApiKeys: state.webSearchApiKeys,
    planOnly: false,
    vfsOnly: false,
    lspSettings: { ...state.lspSettings, enabled: false },
    smartToolSettings: snapshotSmartToolSettings(state),
    jevDecisionTool: snapshotJevDecisionTool(state, model.autoStepUp),
    jevRiskReview: snapshotJevRiskReview(state),
    contextCompaction,
    ...optionalInputs(turn, model, plan, contextCompaction),
    workflow: workflowRun(turn, message, chatHistory, plan),
  };
}

/** Writes a run's Markdown report into the workspace; the note the response ends with says where, or why not. */
export async function saveRunReport(workspaceRoot: string, report: { path: string; content: string }): Promise<string> {
  try {
    await invoke("write_file_disk", { path: `${workspaceRoot.replace(/[\\/]$/, "")}/${report.path}`, content: report.content });
    const note = `\n\n_Result saved to \`${report.path}\`_`;
    await refreshTree();
    return note;
  } catch (error) {
    return `\n\n_The result could not be saved to \`${report.path}\`: ${String(error)}_`;
  }
}
