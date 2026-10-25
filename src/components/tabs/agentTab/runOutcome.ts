import type { ContextCompactionRunConfig } from "../../../harness/core/decideToolConfig";
import type { CapabilityResult, RunHandle, RunOutcome, WorkflowSwitch } from "../../../harness/contract";
import { failedVerificationReport } from "../../../harness/core/workflowRun";
import { notify } from "../../../notificationStore";
import { specsClient } from "../../../specs/client";
import { implementTicker, recordImplementRun, recordSpecRun } from "../../../specs/run";
import { localDate } from "../../../specs/pure";
import { workflowReportFor } from "../../../services/workflowReport";
import type { CustomProvider } from "../../../store";
import { refreshTree } from "../../filetree/FileTreePresenter";
import { AUTO_FLOW } from "../behaviors/flowCatalog";
import { workflowCatalogService } from "../../../services/workflowCatalogService";
import { useWorkflowRunStore } from "../behaviors/workflowRunStore";
import type { RunProgress } from "./runEvents";
import type { RunModel } from "./runModel";
import { saveRunReport, type LaunchPlan, type TurnMessage } from "./runRequest";
import { completedSubagents } from "./subagents";
import { addAssistantMessage, cancelResponseFlush, endTurn, startResponseStream, type AgentTurn } from "./turn";

/** One run of a turn, as its outcome is handled. */
export interface LaunchedRun {
  turn: AgentTurn;
  message: TurnMessage;
  plan: LaunchPlan;
  model: RunModel;
  provider: CustomProvider;
  compaction: ContextCompactionRunConfig;
  progress: RunProgress;
  /** The workspace the run started in. */
  workspaceRoot: string;
  /** Starts the next run of the turn, after a hand-over. */
  relaunch(plan: LaunchPlan): Promise<void>;
  /** Starts the next capability spec of a batch, if one is waiting. */
  next(): Promise<void>;
}

type AgentChatResult = CapabilityResult<"agent_chat">;

const VERIFICATION_INCOMPLETE = "Verification incomplete; see the review in chat.";

function workflowName(plan: LaunchPlan): string {
  return String(plan.workflowDefinition?.name ?? plan.workflowId);
}

function failedReview(turn: AgentTurn, plan: LaunchPlan) {
  return plan.workflowDefinition && failedVerificationReport(plan.workflowDefinition, turn.state.workflowCheckpoint);
}

/** Shows a workflow run in the workflow bar: steps a resumed run already finished, then how it ends. */
export function trackWorkflowRun(turn: AgentTurn, plan: LaunchPlan, run: RunHandle<"agent_chat">) {
  const { workflowId } = plan;
  const store = useWorkflowRunStore.getState();
  store.begin(workflowId);
  const steps = turn.state.workflowCheckpoint?.steps as Record<string, { status?: string; attempts?: unknown[] }> | undefined;
  for (const [nodeId, step] of Object.entries(steps ?? {})) {
    if (step.status === "succeeded") store.step(workflowId, { nodeId, status: "succeeded", attempt: step.attempts?.length ?? 1 });
  }
  turn.state.activeWorkflowId = workflowId;
  turn.state.activeWorkflowRunId = run.runId;
  turn.ui.setStepPlans([]);
  turn.ui.setWorkflowRunning(true);
  void run.done.then((outcome) => {
    if (turn.state.activeWorkflowRunId !== run.runId) return;
    turn.state.activeWorkflowId = null;
    turn.state.activeWorkflowRunId = null;
    turn.ui.setWorkflowRunning(false);
    const status = outcome.status === "completed" ? "completed" : outcome.status === "failed" ? "failed" : "was cancelled";
    turn.state.lastWorkflowRun = { name: workflowName(plan), status };
    const message = outcome.status === "failed"
      ? (failedReview(turn, plan) ? VERIFICATION_INCOMPLETE : outcome.error.message)
      : undefined;
    useWorkflowRunStore.getState().finish(workflowId, outcome.status, message);
  });
}

/** Shows what the run left: the files it changed, opened, and the explorer refreshed. */
async function showChangedFiles(turn: AgentTurn, files: string[]) {
  turn.activity.flushNow();
  cancelResponseFlush(turn.state);
  turn.chat.setModifiedFiles([...turn.state.modifiedFiles, ...files]);
  files.forEach((filePath) => turn.chat.openChangedFile(filePath));
  // The agent may have created the files during the run, so the explorer
  // must observe the completed writes rather than only the command-output refresh.
  if (files.length > 0 && turn.rootPath) await refreshTree();
}

/** A workflow that only looked leaves its Result in a file to pick up later;
 * one that changed files does not (the changes are the outcome). A run that
 * handed over saves nothing: the next run continues from its work, which is
 * already in the conversation. Returns the note the response ends with. */
async function saveReport(run: LaunchedRun, result: AgentChatResult): Promise<string> {
  const { workspaceRoot } = run;
  if (!run.plan.workflowId || !workspaceRoot || result.switchTo) return "";
  const report = workflowReportFor({
    workflowName: workflowName(run.plan),
    request: run.message.text,
    text: result.response,
    changedFiles: [...run.progress.changed, ...result.modifiedFiles],
  });
  return report ? saveRunReport(workspaceRoot, report) : "";
}

/** What the run leaves behind: a Specify or Plan run writes its documents into the change folder;
 * any other run may save its report. Returns the note the response ends with. */
async function saveOutcome(run: LaunchedRun, result: AgentChatResult): Promise<string> {
  const { spec } = run.plan;
  if (!spec) return saveReport(run, result);
  const { lastWorkflowState: state } = run.turn.state;
  const note = spec.step === "implement"
    ? await recordImplementRun(specsClient, spec, state, true, localDate())
    : await recordSpecRun(specsClient, spec, run.plan.workflowDefinition, state, localDate());
  await refreshTree();
  return note;
}

/** The run handed over: the same turn goes on in the workflow it chose.
 * Whether the next run started. */
async function handOver(run: LaunchedRun, switchTo: WorkflowSwitch, finalResponse: string): Promise<boolean> {
  const { turn, plan } = run;
  if (plan.switchesLeft <= 0 || !turn.state.isStreaming) return false;
  turn.state.responseStream?.finish(finalResponse);
  startResponseStream(turn, (content) => {
    turn.activity.appendText(content);
    turn.activity.flush();
  });
  turn.state.agentRun = null;
  turn.ui.setStreamingLabel(`Starting ${switchTo.name}…`);
  try {
    const nextDefinition = await workflowCatalogService.workflow(turn.rootPath, switchTo.path);
    if (!turn.state.isStreaming) return false;
    // A chat that follows one workflow now follows the one it handed over to; Auto keeps choosing per message.
    if (turn.state.chatWorkflow === AUTO_FLOW) turn.ui.setAutoWorkflow(switchTo.path);
    else turn.chat.setChatWorkflow(switchTo.path);
    await run.relaunch({
      workflowDefinition: nextDefinition,
      workflowId: String(nextDefinition.id ?? ""),
      context: switchTo.context,
      switchesLeft: plan.switchesLeft - 1,
      visited: [...plan.visited, switchTo.id],
    });
    return true;
  } catch (error) {
    notify("Could not hand over", `Could not read ${switchTo.path}: ${String(error)}. The turn ends here.`, "error");
    return false;
  }
}

async function onCompleted(run: LaunchedRun, result: AgentChatResult) {
  const { turn } = run;
  await showChangedFiles(turn, result.modifiedFiles);
  const finalResponse = (result.response || "Agent complete.") + await saveOutcome(run, result);
  if (result.subagents.length > 0) turn.ui.setSubagents(completedSubagents(result.subagents));
  if (result.switchTo && await handOver(run, result.switchTo, finalResponse)) return;
  turn.state.responseStream?.finish(finalResponse);
  endTurn(turn);
  void turn.chat.save();
  turn.chat.refreshHistorySummary(run.provider, run.model.modelId, run.compaction);
  if (run.plan.spec?.step === "capability") void run.next();
}

/** An Implement run ticks each task in the change folder as soon as the queue accepts it. */
export function implementTicks(plan: LaunchPlan): ((state: unknown) => void) | undefined {
  const { spec } = plan;
  return spec?.step === "implement" ? implementTicker(specsClient, spec, localDate, () => void refreshTree()) : undefined;
}

/** An Implement run that failed or was stopped keeps what it finished: those tasks are ticked in the folder. */
function keepImplementProgress(run: LaunchedRun) {
  const { spec } = run.plan;
  if (spec?.step !== "implement") return;
  void recordImplementRun(specsClient, spec, run.turn.state.lastWorkflowState, false, localDate()).then(() => refreshTree());
}

function onFailed(run: LaunchedRun, message: string) {
  const { turn } = run;
  turn.state.specQueue = [];
  keepImplementProgress(run);
  const review = failedReview(turn, run.plan);
  turn.activity.append(review ? VERIFICATION_INCOMPLETE : `Error: ${message}`, "update");
  turn.activity.flushNow();
  cancelResponseFlush(turn.state);
  turn.state.responseStream?.flush();
  addAssistantMessage(turn, review ?? `Error: ${message}`);
  endTurn(turn);
  if (review) notify("Verification incomplete", "The workflow finished with unresolved findings. See the review in chat.", "error");
  else notify("Agent Error", `The agent encountered an error: ${message}`, "error");
  void turn.chat.save();
}

/** Ends the turn with the run's outcome, or goes on in the workflow it handed over to. A cancelled run was ended by Stop. */
export async function handleRunOutcome(run: LaunchedRun, outcome: RunOutcome<"agent_chat">) {
  if (outcome.status === "completed") await onCompleted(run, outcome.result);
  else if (outcome.status === "failed") onFailed(run, outcome.error.message);
  else {
    // Stopped: the batch ends here.
    run.turn.state.specQueue = [];
    keepImplementProgress(run);
  }
}
