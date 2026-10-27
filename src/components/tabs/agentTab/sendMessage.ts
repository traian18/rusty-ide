import { harness } from "../../../harness";
import { priorWorkflowContext } from "../../../harness/core/workflowRun";
import { notify } from "../../../notificationStore";
import { executionObservability } from "../../../observability/executionStore";
import { jevFlowRecord } from "../../../observability/modelSelectionRecord";
import { chooseFlow, type FlowCandidate, type FlowChoice } from "../../../services/autoFlowSelection";
import { buildAttachmentContext } from "../../../services/contextAttachmentService";
import { snapshotContextCompaction, snapshotFlowRouter } from "../../../services/jevDecisionToolSnapshot";
import { specsClient } from "../../../specs/client";
import { workflowCatalogService } from "../../../services/workflowCatalogService";
import { useWorkspaceStore, type AgentMessage } from "../../../store";
import { resolveExecutionProvider } from "../../../store/resolveExecutionProvider";
import type { SpecRun } from "../../../specs/run";
import { AUTO_FLOW, shortWorkflowId } from "../behaviors/flowCatalog";
import { runEventHandler, type RunProgress } from "./runEvents";
import { agentRunHost } from "./runHost";
import { resolveRunModel } from "./runModel";
import { handleRunOutcome, implementTicks, trackWorkflowRun, type LaunchedRun } from "./runOutcome";
import { agentChatInput, flowCandidateName, workflowStepTypesOf, type LaunchPlan, type TurnMessage } from "./runRequest";
import { abandonTurn, DEFAULT_STREAMING_LABEL, startResponseStream, type AgentTurn } from "./turn";

const MAX_FLOW_SWITCHES_PER_MESSAGE = 2;

export interface AttachedFile {
  path: string;
  name: string;
  isDir?: boolean;
}

type WorkflowDefinition = Record<string, unknown>;

function workflowIdOf(definition: WorkflowDefinition | undefined): string {
  return definition ? String(definition.id ?? "") : "";
}

/** The saved file is what runs, read fresh so edits saved in the Behaviors
 * tab since the last message apply. Null when it cannot be read: the user
 * has been told. */
async function readFollowedWorkflow(turn: AgentTurn, path: string | undefined): Promise<WorkflowDefinition | undefined | null> {
  if (!path) return undefined;
  try {
    return await workflowCatalogService.workflow(turn.rootPath, path);
  } catch (error) {
    notify("Workflow unavailable", `Could not read ${path}: ${String(error)}. Choose another in the Mode picker.`, "error");
    return null;
  }
}

/** Adds the user's message and the console message its activity goes to,
 * and starts the turn. */
async function postMessage(turn: AgentTurn, draft: string, attachedFiles: AttachedFile[]): Promise<TurnMessage> {
  const now = Date.now();
  const attachments = attachedFiles.map((a) => ({ path: a.path, name: a.name, isDir: a.isDir }));
  const attachmentContext = await buildAttachmentContext(attachedFiles);
  const text = draft.trim() || (attachments.length > 0 ? "Inspect the attached context." : "");
  const timestamp = new Date().toISOString();
  const userMessage: AgentMessage = {
    id: `msg_${now}`, role: "user", content: text, timestamp, phase: "query", attachments,
    attachmentContext: attachmentContext || undefined,
  };
  const consoleMessageId = `msg_${now}_console`;
  turn.addMessage(userMessage);
  turn.addMessage({ id: consoleMessageId, role: "console", content: "", timestamp, phase: "activity" });
  turn.activity.writeTo(consoleMessageId);
  turn.state.delegatedSubagentIds = new Set();
  turn.state.activeWorkflowAgentStep = null;
  startResponseStream(turn, (content) => turn.activity.report(content));
  turn.ui.setSubagents([]);
  turn.ui.setAgentQuestions([]);
  turn.chat.clearWorkflowQuestions();
  turn.state.questionResolvers.clear();
  turn.ui.setRunUsage(null);
  void turn.chat.save();

  turn.ui.setMessage("");
  turn.state.isStreaming = true;
  turn.ui.setIsStreaming(true);
  turn.ui.setStreamingLabel(DEFAULT_STREAMING_LABEL);
  return { id: userMessage.id, text, toSend: attachmentContext ? `${text}\n\n${attachmentContext}` : text };
}

/** The workflows Auto may choose from: those that say when they apply. */
function autoCandidates(turn: AgentTurn): FlowCandidate[] {
  return turn.state.workflowOptions
    .filter((option) => option.route && option.id)
    .map((option) => ({
      id: option.id!,
      name: flowCandidateName(option),
      criterion: option.route!,
      edits: Boolean(option.edits),
      path: option.path,
    }));
}

async function routeMessage(turn: AgentTurn, message: TurnMessage): Promise<FlowChoice> {
  const routerConfig = snapshotFlowRouter(useWorkspaceStore.getState());
  const candidates = autoCandidates(turn);
  if (!routerConfig) {
    turn.state.responseStream?.progress("↳ AUTO · OpenRouter and a JEV model are needed to choose a workflow; answering directly.");
    return { type: "single" };
  }
  if (candidates.length === 0) return { type: "single" };
  // The conversation so far (the new message is already in it), so a follow-up is routed in its setting.
  const chats = useWorkspaceStore.getState().agentChats[turn.chatId] || [];
  return chooseFlow({
    message: message.text,
    recentRequests: chats.filter((m) => m.role === "user" && m.id !== message.id).map((m) => m.content),
    lastResult: priorWorkflowContext(chats),
    lastRun: turn.state.lastWorkflowRun,
    candidates,
    router: {
      ...routerConfig,
      onTrace: (trace) => executionObservability.recordStandalone(
        jevFlowRecord(trace, { tabId: turn.chatId, workspaceRoot: useWorkspaceStore.getState().rootPath || undefined }),
      ),
    },
    announce: (line) => turn.state.responseStream?.progress(line),
  });
}

/** With Auto, Rusty chooses the workflow once the message is in the chat.
 * The workflow to run (none: the single agent), or null when the user
 * stopped the turn while it chose. */
async function chooseAutoWorkflow(turn: AgentTurn, message: TurnMessage): Promise<WorkflowDefinition | undefined | null> {
  turn.ui.setStreamingLabel("Choosing a workflow…");
  const choice = await routeMessage(turn, message);
  if (!turn.state.isStreaming) return null;
  let definition: WorkflowDefinition | undefined;
  let path: string | undefined;
  if (choice.type === "workflow") {
    try {
      definition = await workflowCatalogService.workflow(turn.rootPath, choice.candidate.path);
      path = choice.candidate.path;
    } catch (error) {
      notify("Workflow unavailable", `Could not read ${choice.candidate.path}: ${String(error)}. Answering directly.`, "error");
    }
  }
  turn.ui.setAutoWorkflow(path);
  // A failed run resumes only on the workflow it belongs to.
  const checkpoint = turn.state.workflowCheckpoint;
  if (checkpoint && checkpoint.definition_id !== workflowIdOf(definition)) turn.chat.setWorkflowCheckpoint(undefined);
  turn.ui.setStreamingLabel(DEFAULT_STREAMING_LABEL);
  return definition;
}

/** Starts one run for the message: a single agent, or a workflow. A workflow
 * that hands over ends with `switchTo`, and the next run starts from there in
 * the same turn. */
async function launch(turn: AgentTurn, message: TurnMessage, plan: LaunchPlan): Promise<void> {
  const workspaceRoot = useWorkspaceStore.getState().rootPath;
  const model = await resolveRunModel(turn, Boolean(plan.workflowDefinition), message.toSend);
  // The chat may have been closed or stopped while the model was chosen.
  if (!model || turn.state.disposed || !turn.state.isStreaming) return;
  const store = useWorkspaceStore.getState();
  const resolution = resolveExecutionProvider(store.customProviders, store.providerStatus, store.activeCustomProviderId, model.modelId);
  if (!resolution.ok) {
    abandonTurn(turn, resolution.message, "Cannot send message", resolution.message);
    return;
  }
  const compaction = snapshotContextCompaction(store);
  const input = agentChatInput(turn, message, model, resolution.provider, plan, compaction);
  const progress: RunProgress = { stepTypes: workflowStepTypesOf(plan.workflowDefinition), changed: new Set(), onCheckpoint: implementTicks(plan) };
  const run = harness.run(
    "agent_chat",
    input,
    agentRunHost(turn),
    runEventHandler(turn, progress),
    { surface: "agent-tab", tabId: turn.tab.id, displayLabel: turn.tab.title || "Agent" },
  );
  if (plan.workflowId) trackWorkflowRun(turn, plan, run);
  else turn.state.lastWorkflowRun = undefined;
  const launched: LaunchedRun = {
    turn, message, plan, model, progress, workspaceRoot,
    provider: resolution.provider,
    compaction,
    relaunch: (next) => launch(turn, message, next),
    next: () => continueSpecQueue(turn),
  };
  // A closed chat's run was cancelled with it; what it left goes nowhere.
  void run.done.then((outcome) => turn.state.disposed ? undefined : handleRunOutcome(launched, outcome));
  turn.state.agentRun = run;
}

/** Sends the chat box's message: in the chat's workflow, the one Auto
 * chooses, or to the single agent. */
export async function sendMessage(turn: AgentTurn, draft: string, attachedFiles: AttachedFile[], hasSelectedSkill: boolean) {
  // A run set up from the Specs page runs in its step's workflow, even when the chat was started
  // over (New chat) after it was set up; choosing another workflow in the Mode picker drops it.
  const specRun = turn.state.specRun;
  if (specRun && turn.state.chatWorkflow !== specRun.workflowPath) turn.chat.setChatWorkflow(specRun.workflowPath);
  const chosenWorkflow = turn.state.chatWorkflow;
  const auto = chosenWorkflow === AUTO_FLOW;
  // A workflow's steps get their tools from their own profiles, so the chat's
  // skill plays no part in a workflow run (it stays on Build). Auto may still
  // answer with the single agent, which needs one.
  if ((!chosenWorkflow || auto) && !hasSelectedSkill) {
    notify("Skill Required", "Select an Agent Tab skill before sending a prompt.", "error");
    return;
  }
  let workflowDefinition = await readFollowedWorkflow(turn, auto ? undefined : chosenWorkflow);
  if (workflowDefinition === null) return;
  const spec = await startingSpecRun(turn, chosenWorkflow);
  if (spec === null) return;
  // A later message to the workflow implementing the chat's change (say,
  // "continue" after a failure) goes on ticking its tasks.
  const followed = spec === undefined && chosenWorkflow && turn.state.followedSpec?.workflowPath === chosenWorkflow ? turn.state.followedSpec : undefined;
  const message = await postMessage(turn, draft, attachedFiles);
  if (auto) {
    workflowDefinition = await chooseAutoWorkflow(turn, message);
    if (workflowDefinition === null) return;
  }
  const workflowId = workflowIdOf(workflowDefinition);
  await launch(turn, message, {
    workflowDefinition,
    workflowId,
    switchesLeft: MAX_FLOW_SWITCHES_PER_MESSAGE,
    visited: workflowDefinition ? [shortWorkflowId(workflowId)] : [],
    ...(spec ? { spec: spec.run, context: spec.context, ...(spec.inputs ? { inputs: spec.inputs } : {}) } : {}),
    ...(followed ? { spec: { root: followed.root, change: followed.change, step: followed.step } } : {}),
  });
}

/** Starts the next capability spec of a batch in the same chat, with the same workflow. */
async function continueSpecQueue(turn: AgentTurn): Promise<void> {
  const next = turn.state.specQueue.shift();
  const workflowPath = turn.state.chatWorkflow;
  if (!next || !workflowPath) return;
  turn.state.specRun = { ...next.run, workflowPath };
  await sendMessage(turn, next.message, [], true);
}

/** A Specify, Plan or Implement run set up from the Specs page and still followed by the chat: what it
 * starts from is composed from the files now, so edits made since the tab opened are included. An
 * Implement run also gets the task plans from the files, and starts afresh rather than resuming a
 * failed run (the folder holds the progress). `undefined` when there is none, `null` when it could
 * not be composed (the person is told). */
async function startingSpecRun(turn: AgentTurn, chosenWorkflow: string | undefined): Promise<{ run: SpecRun; context: string; inputs?: Record<string, unknown> } | undefined | null> {
  const pending = turn.state.specRun;
  turn.state.specRun = undefined;
  if (!pending || pending.workflowPath !== chosenWorkflow) return undefined;
  try {
    const context = await specsClient.context(pending.root, pending.change, pending.step, useWorkspaceStore.getState().rootPath || undefined);
    turn.chat.setWorkflowCheckpoint(undefined);
    turn.state.followedSpec = pending.step === "implement" ? { root: pending.root, change: pending.change, step: "implement", workflowPath: pending.workflowPath } : undefined;
    if (pending.step !== "implement") return { run: pending, context };
    const plans = await specsClient.queuePlan(pending.root, pending.change);
    return { run: pending, context, inputs: { plan: plans.full, queue_plan: plans.remaining } };
  } catch (error) {
    notify("Cannot start", `The change could not be read: ${String(error instanceof Object && "message" in error ? (error as { message: unknown }).message : error)}`, "error");
    return null;
  }
}
