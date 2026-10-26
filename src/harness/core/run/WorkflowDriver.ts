// A run that executes a workflow on its session instead of a single agent
// loop. Step agents' events reuse the run's normal handling (tokens, tool
// logs, usage); their own completion is the workflow's business.

import type { AgentEvent, AgentEventEnvelope, ToolCall } from "@rusty/harness-sdk";
import type { CapabilityEvent, CapabilityName, CapabilityResult, WorkflowAnswer, WorkflowQuestion } from "../../contract";
import { executionObservability } from "../../../observability/executionStore";
import { trajectories } from "../../../observability/trajectoryStore";
import type { SessionRecipe } from "../SessionRecipe";
import { describeWorkflowEvent, stepNames, workflowOutcome, type WorkflowEventEnvelope } from "../workflowRun";
import { errorMessage, observe } from "./failures";
import { WorkflowBoundary } from "./WorkflowBoundary";
import { nodeIdOf, type WorkflowRunAccess, type WorkflowSpec } from "./workflowRunAccess";

type WorkflowEvent = WorkflowEventEnvelope["event"];

/** A question a step asked the user (an approval), or undefined without a request id. */
function questionFrom(event: WorkflowEvent, names: Record<string, string>): WorkflowQuestion | undefined {
  const request = (event.request ?? {}) as { id?: unknown; kind?: unknown; prompt?: unknown; subject?: unknown; decisions?: unknown };
  const requestId = String(request.id ?? "");
  if (!requestId) return undefined;
  const nodeId = nodeIdOf(event);
  return {
    requestId,
    step: names[nodeId] ?? nodeId,
    kind: String(request.kind ?? ""),
    prompt: String(request.prompt ?? ""),
    subject: request.subject,
    decisions: (Array.isArray(request.decisions) ? request.decisions : []).map((decision: { id?: unknown; label?: unknown; requires_text?: unknown }) => ({
      id: String(decision?.id ?? ""),
      label: String(decision?.label ?? decision?.id ?? ""),
      requiresText: decision?.requires_text === true,
    })),
  };
}

export class WorkflowDriver<K extends CapabilityName> {
  /** Undefined for a normal agent loop. */
  readonly spec: WorkflowSpec | undefined;
  readonly id: string;
  private readonly run: WorkflowRunAccess<K>;
  private readonly names: Record<string, string>;
  private readonly boundary: WorkflowBoundary<K>;
  /** Research a workflow step asked for and that has not answered yet, by tool call id. */
  private readonly pendingResearch = new Map<string, { nodeId: string; question: string }>();
  /** Set once the run's final state was handed on; a checkpoint read before it must not replace it. */
  private finished = false;

  constructor(run: WorkflowRunAccess<K>) {
    this.run = run;
    this.spec = run.definition.workflow?.(run.input);
    this.id = this.spec ? String((this.spec.definition as { id?: unknown } | null)?.id ?? "") : "";
    this.names = this.spec ? stepNames(this.spec.definition) : {};
    this.boundary = new WorkflowBoundary(run, this.spec, this.names, this.id);
  }

  /** The session is created from the run's recipe as usual, so the workflow's
   * agent steps share its backend, tools and host tool handlers. */
  attachTo(recipe: SessionRecipe): SessionRecipe {
    return this.spec ? { ...recipe, workflow: this.spec.definition } : recipe;
  }

  async start(sessionId: string, spec: WorkflowSpec): Promise<void> {
    const { engine } = this.run;
    if (!engine.startWorkflow) throw new Error("This build of the harness cannot run workflows.");
    observe(() => trajectories.append(this.run.runId, "Workflow", { workflow: this.id, input: spec.input }));
    await engine.startWorkflow(sessionId, spec.input, spec.checkpoint, spec.options);
  }

  researchRequested(call: ToolCall): void {
    const stepId = this.run.context.scratch.workflowStepId;
    if (call.name !== "request_research" || !this.spec || typeof stepId !== "string") return;
    const question = String((call.arguments as { question?: unknown } | null)?.question ?? "").trim();
    this.pendingResearch.set(call.id, { nodeId: stepId, question });
    this.run.onEvent({ kind: "workflow_research", workflowId: this.id, nodeId: stepId, callId: call.id, question, status: "running" } as CapabilityEvent<K>);
  }

  researchAnswered(callId: string, failed: boolean): void {
    const research = this.pendingResearch.get(callId);
    if (!research) return;
    this.pendingResearch.delete(callId);
    this.run.onEvent({ kind: "workflow_research", workflowId: this.id, ...research, callId, status: failed ? "failed" : "done" } as CapabilityEvent<K>);
  }

  onEvent(envelope: WorkflowEventEnvelope): void {
    const { log, step } = describeWorkflowEvent(envelope, this.names);
    if (log) this.run.log(log);
    if (step) this.stepChanged(step);
    if (envelope.event.type === "input_requested") this.answerQuestion(envelope.event);
    if (envelope.event.type === "task_progress") void this.reportCheckpoint();
    this.boundary.onEvent(envelope.event);
  }

  /** The task queue recorded a checkpoint (a task was accepted): hand the run's state on while it
   * runs, so an Implement run ticks the task in its change right away instead of at the end. */
  private async reportCheckpoint(): Promise<void> {
    const sessionId = this.run.sessionId();
    if (!sessionId || !this.run.engine.workflowState) return;
    const state = await this.run.engine.workflowState(sessionId).catch((error: unknown) => {
      observe(() => trajectories.append(this.run.runId, "Checkpoint read failed", { error: errorMessage(error) }));
      return undefined;
    });
    if (state && !this.finished) this.run.onEvent({ kind: "workflow_checkpoint", state } as CapabilityEvent<K>);
  }

  onAgentEvent(envelope: AgentEventEnvelope): void {
    const event = envelope.event as AgentEvent;
    if ("Completed" in event || "Failed" in event) {
      observe(() => executionObservability.ingest(this.run.runId, envelope));
      return;
    }
    if ("PermissionRequested" in event) {
      observe(() => executionObservability.ingest(this.run.runId, envelope));
      const request = event.PermissionRequested.request;
      this.run.requestPermission(request, (decision) => {
        const sessionId = this.run.sessionId();
        return sessionId ? this.run.engine.workflowControl?.(sessionId, { type: "resolve_permission", id: request.id, decision }) : undefined;
      });
      return;
    }
    this.run.onAgentEvent(envelope);
  }

  onFinished(state: unknown): void {
    this.finished = true;
    this.run.onEvent({ kind: "workflow_checkpoint", state } as CapabilityEvent<K>);
    const outcome = workflowOutcome(state);
    if (outcome.status === "cancelled") return this.finishCancelled();
    if (outcome.status === "failed") {
      this.run.settle({ status: "failed", error: { code: outcome.code, message: outcome.message } });
      return;
    }
    this.settleWith(() => {
      if (!this.run.definition.workflowResult) throw new Error("This capability cannot report a workflow result.");
      return this.run.definition.workflowResult(outcome.output, this.run.input, this.run.context);
    });
  }

  private stepChanged(step: NonNullable<ReturnType<typeof describeWorkflowEvent>["step"]>): void {
    const name = this.names[step.nodeId] ?? step.nodeId;
    if (step.status === "running") {
      this.run.context.scratch.workflowStep = name;
      this.run.context.scratch.workflowStepId = step.nodeId;
    }
    this.run.onEvent({ kind: "workflow_step", workflowId: this.id, ...step, name } as CapabilityEvent<K>);
  }

  /** A run that handed over was cancelled on purpose: it succeeded in
   * passing its work on, and its result says where. */
  private finishCancelled(): void {
    const handedOver = this.run.context.scratch.flowSwitch;
    const { definition, input, context } = this.run;
    if (handedOver === undefined || !definition.workflowSwitched) {
      this.run.settle({ status: "cancelled" });
      return;
    }
    this.settleWith(() => definition.workflowSwitched!(handedOver, input, context));
  }

  private settleWith(result: () => CapabilityResult<K>): void {
    try {
      this.run.settle({ status: "completed", result: result() });
    } catch (error: unknown) {
      this.run.settle({ status: "failed", error: { code: "CORE_RESULT_FAILED", message: errorMessage(error) } });
    }
  }

  private answerQuestion(event: WorkflowEvent): void {
    const question = questionFrom(event, this.names);
    if (!question) return;
    if (!this.run.host.askWorkflowInput) {
      this.run.log(`${question.step} is waiting for an answer this view cannot give.`);
      return;
    }
    this.askUntilAccepted(question);
  }

  /** Shows the question, then sends the answer back; an answer the run refuses is asked again. */
  private askUntilAccepted(question: WorkflowQuestion): void {
    void this.run.host.askWorkflowInput!(question, this.run.signal)
      .then((answer) => this.resolveInput(question.requestId, answer))
      .catch((error: unknown) => {
        if (!this.run.isLive()) return;
        this.run.log(`The answer was not accepted: ${errorMessage(error)}`);
        this.askUntilAccepted(question);
      });
  }

  private resolveInput(requestId: string, answer: WorkflowAnswer): Promise<void> | undefined {
    const sessionId = this.run.sessionId();
    const { engine } = this.run;
    if (!this.run.isLive() || !sessionId || !engine.workflowControl) return undefined;
    return engine.workflowControl(sessionId, { type: "resolve_input", request_id: requestId, decision: answer.decision, ...(answer.text ? { text: answer.text } : {}) });
  }
}
