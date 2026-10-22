// Handing over at a step boundary: pausing at a step's start lets that step
// finish while the next one is held; at its end the definition decides
// whether the run carries on or switches to another workflow.

import type { CapabilityEvent, CapabilityName } from "../../contract";
import { trajectories } from "../../../observability/trajectoryStore";
import type { WorkflowBoundaryDecision } from "../CoreHarness";
import { finishedAgentSteps, remainingAgentSteps, type WorkflowEventEnvelope } from "../workflowRun";
import { errorMessage, ignoreFailure, observe } from "./failures";
import { nodeIdOf, type WorkflowRunAccess, type WorkflowSpec } from "./workflowRunAccess";

type BoundaryStatus = "checking" | "switch" | "continue";

export class WorkflowBoundary<K extends CapabilityName> {
  private readonly run: WorkflowRunAccess<K>;
  private readonly spec: WorkflowSpec | undefined;
  private readonly names: Record<string, string>;
  private readonly workflowName: string;
  /** Only a run that may switch flows is paused at its step boundaries. */
  private readonly enabled: boolean;
  private readonly stepTypes: Map<string, string>;
  /** The step the run is held after, while it is held. */
  private heldAfter: string | undefined;

  constructor(run: WorkflowRunAccess<K>, spec: WorkflowSpec | undefined, names: Record<string, string>, workflowId: string) {
    this.run = run;
    this.spec = spec;
    this.names = names;
    this.workflowName = String((spec?.definition as { name?: unknown } | null)?.name ?? workflowId);
    this.enabled = Boolean(spec && run.definition.workflowBoundary && run.definition.switchesFlows?.(run.input));
    const nodes = (spec?.definition as { nodes?: Array<{ id?: unknown; type?: unknown }> } | null)?.nodes ?? [];
    this.stepTypes = new Map(nodes.map((node) => [String(node.id), String(node.type)]));
  }

  onEvent(event: WorkflowEventEnvelope["event"]): void {
    if (!this.enabled || this.run.isSettled()) return;
    const nodeId = nodeIdOf(event);
    if (event.type === "step_started") return this.holdAfter(nodeId);
    if (this.heldAfter !== nodeId) return;
    if (event.type === "step_succeeded") {
      this.heldAfter = undefined;
      void this.decide(nodeId);
    } else if (event.type === "step_failed" || event.type === "step_retry_scheduled") {
      // The failure path must not be held: release the pause so retries and failure edges proceed.
      this.heldAfter = undefined;
      this.control("resume").catch(ignoreFailure("resuming the workflow after a failed step"));
    }
  }

  private holdAfter(nodeId: string): void {
    if (!this.holdsAfter(nodeId)) return;
    this.heldAfter = nodeId;
    this.control("pause").catch(() => {
      // Already paused or finished: nothing to hold.
      if (this.heldAfter === nodeId) this.heldAfter = undefined;
    });
  }

  /** An agent step with another agent step after it, while nothing is held. */
  private holdsAfter(nodeId: string): boolean {
    if (this.stepTypes.get(nodeId) !== "agent" || this.heldAfter !== undefined) return false;
    return remainingAgentSteps(this.spec!.definition, nodeId).length > 0;
  }

  private async decide(nodeId: string): Promise<void> {
    const sessionId = this.run.sessionId();
    if (!sessionId || !this.spec || !this.run.definition.workflowBoundary) return;
    const step = { id: nodeId, name: this.names[nodeId] ?? nodeId };
    this.announce("checking", step.name);
    const decision = await this.ask(this.spec, sessionId, step);
    // The run was stopped or finished while the decision was pending.
    if (!this.run.isLive()) return;
    if (decision.type === "switch") {
      await this.switchFlow(decision.outcome, step.name);
      return;
    }
    this.announce("continue", step.name);
    await this.control("resume").catch((error: unknown) => {
      this.run.log(`Could not resume the workflow: ${errorMessage(error)}`);
    });
  }

  /** The definition's decision; a failure is treated as `continue`. */
  private async ask(spec: WorkflowSpec, sessionId: string, step: { id: string; name: string }): Promise<WorkflowBoundaryDecision> {
    const { run } = this;
    try {
      const state = await run.engine.workflowState?.(sessionId, step.id);
      return await run.definition.workflowBoundary!({
        input: run.input,
        host: run.host,
        ctx: run.context,
        onEvent: run.onEvent,
        signal: run.signal,
        step,
        finished: finishedAgentSteps(spec.definition, state),
        remaining: remainingAgentSteps(spec.definition, step.id).map((id) => this.names[id] ?? id),
        request: String((spec.input as { request?: unknown } | null)?.request ?? ""),
      });
    } catch (error: unknown) {
      observe(() => trajectories.append(run.runId, "Flow boundary failed", { error: errorMessage(error) }));
      return { type: "continue" };
    }
  }

  private async switchFlow(outcome: unknown, stepName: string): Promise<void> {
    const { scratch } = this.run.context;
    scratch.flowSwitch = outcome;
    this.announce("switch", stepName);
    await this.control("cancel").catch((error: unknown) => {
      // Could not end the run: let it go on rather than leave it paused.
      delete scratch.flowSwitch;
      this.run.log(`Could not hand over: ${errorMessage(error)}`);
      return this.control("resume").catch(ignoreFailure("resuming the workflow after a failed hand-over"));
    });
  }

  private announce(status: BoundaryStatus, step: string): void {
    this.run.onEvent({ kind: "workflow_boundary", status, workflow: this.workflowName, step } as CapabilityEvent<K>);
  }

  private control(type: "pause" | "resume" | "cancel"): Promise<void> {
    const sessionId = this.run.sessionId();
    const { engine } = this.run;
    if (sessionId && engine.workflowControl) return engine.workflowControl(sessionId, { type });
    return Promise.reject(new Error("This build of the harness cannot control workflows."));
  }
}
