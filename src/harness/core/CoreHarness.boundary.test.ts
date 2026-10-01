import { describe, expect, it } from "vitest";
import type { MutationCommand } from "@rusty/harness-sdk";

import type { CapabilityEvent, InlineChatInput } from "../contract";
import type { HarnessControlPlane } from "../contract/controlPlane";
import { createRecordingHost } from "../testing/recordingHost";
import type { BridgeEvent, CoreEngine, WorkflowControl } from "./engine/CoreEngineClient";
import {
  CoreHarness,
  type CoreCapabilityDefinition,
  type ExecutionAnswerer,
  type WorkflowBoundaryContext,
  type WorkflowBoundaryDecision,
} from "./CoreHarness";
import type { SessionRecipe } from "./SessionRecipe";
import { finishedAgentSteps, remainingAgentSteps, stepOrder } from "./workflowRun";

class FakeEngine implements CoreEngine {
  controls: WorkflowControl[] = [];
  stateRequests: Array<string | undefined> = [];
  state: unknown = {
    status: "paused",
    steps: { plan: { status: "succeeded", output: "the plan" }, build: { status: "pending" } },
  };
  private listener?: (event: BridgeEvent) => void;

  createSession(_recipe: SessionRecipe) {
    return Promise.resolve("session-1");
  }
  subscribe(_sessionId: string, onEvent: (event: BridgeEvent) => void) {
    this.listener = onEvent;
    return Promise.resolve();
  }
  mutate(_sessionId: string, _command: MutationCommand) {
    return Promise.resolve();
  }
  hostToolResult() {
    return Promise.resolve();
  }
  hostExecuteEvent() {
    return Promise.resolve();
  }
  hostExecuteResult() {
    return Promise.resolve();
  }
  closeSession() {
    return Promise.resolve();
  }
  startWorkflow() {
    return Promise.resolve("run-1");
  }
  workflowControl(_sessionId: string, control: WorkflowControl) {
    this.controls.push(control);
    return Promise.resolve();
  }
  workflowState(_sessionId: string, afterStep?: string) {
    this.stateRequests.push(afterStep);
    return Promise.resolve(this.state);
  }
  emit(event: BridgeEvent) {
    this.listener?.(event);
  }
}

const WORKFLOW = {
  id: "plan-build-verify",
  name: "Plan, build, verify",
  nodes: [
    { id: "input", name: "Request", type: "input" },
    { id: "plan", name: "Plan", type: "agent" },
    { id: "build", name: "Build", type: "agent" },
    { id: "verify", name: "Verify", type: "agent" },
    { id: "output", name: "Result", type: "output" },
  ],
  edges: [
    { id: "a", source: "input", target: "plan", condition: "on_success" },
    { id: "b", source: "plan", target: "build", condition: "on_success" },
    { id: "c", source: "build", target: "verify", condition: "on_success" },
    { id: "d", source: "verify", target: "output", condition: "on_success" },
  ],
};

const INPUT = { message: "ship it", workspaceRoot: "/ws" } as unknown as InlineChatInput;
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

type Boundary = (context: WorkflowBoundaryContext<"inline_chat">) => Promise<WorkflowBoundaryDecision>;

async function start(boundary: Boundary, options: { switches?: boolean; workflow?: unknown } = {}) {
  const engine = new FakeEngine();
  const definition: CoreCapabilityDefinition<"inline_chat"> = {
    capability: "inline_chat",
    recipe: () => ({ workspace: { root: "/ws", binding: "host" }, integration: "host" }),
    promptText: () => "unused",
    toResult: () => ({ response: "unused" }),
    usageContext: () => ({ workspaceRoot: "/ws", model: "m" }),
    workflow: () => ({ definition: options.workflow ?? WORKFLOW, input: { request: "ship it" } }),
    workflowResult: () => ({ response: "finished" }),
    switchesFlows: () => options.switches ?? true,
    workflowBoundary: boundary,
    workflowSwitched: (outcome) => ({ response: `switched to ${(outcome as { to: string }).to}` }),
  };
  const harness = new CoreHarness({
    engine,
    controlPlane: { recordUsage: async () => {} } as unknown as HarnessControlPlane,
    executionAnswerer: {} as ExecutionAnswerer,
    definitions: { inline_chat: definition },
  });
  const { host } = createRecordingHost();
  const events: CapabilityEvent<"inline_chat">[] = [];
  const handle = harness.run("inline_chat", INPUT, host, (event) => events.push(event));
  await handle.started;
  await flush();
  const stepEvent = (type: string, nodeId: string) => engine.emit({ kind: "workflow_event", data: { event: { type, node_id: nodeId, attempt: 1 } } });
  return { engine, handle, events, stepEvent };
}

const carryOn: Boundary = async () => ({ type: "continue" });

describe("holding a workflow at a step boundary", () => {
  it("pauses when a step with another agent step after it starts, then carries on when the definition says so", async () => {
    const seen: Array<Parameters<Boundary>[0]["step"] | unknown> = [];
    const { engine, events, stepEvent } = await start(async (context) => {
      seen.push({ step: context.step, finished: context.finished, remaining: context.remaining, request: context.request });
      return { type: "continue" };
    });
    stepEvent("step_started", "plan");
    await flush();
    expect(engine.controls).toEqual([{ type: "pause" }]);

    stepEvent("step_succeeded", "plan");
    await flush();
    expect(engine.stateRequests).toEqual(["plan"]);
    expect(seen).toEqual([{
      step: { id: "plan", name: "Plan" },
      finished: [{ id: "plan", name: "Plan", output: "the plan" }],
      remaining: ["Build", "Verify"],
      request: "ship it",
    }]);
    expect(engine.controls).toEqual([{ type: "pause" }, { type: "resume" }]);
    expect(events.filter((event) => event.kind === "workflow_boundary").map((event) => (event as { status: string }).status)).toEqual(["checking", "continue"]);
  });

  it("holds each step in turn, but never the last agent step", async () => {
    const { engine, stepEvent } = await start(carryOn);
    stepEvent("step_started", "plan");
    stepEvent("step_succeeded", "plan");
    await flush();
    stepEvent("step_started", "build");
    await flush();
    expect(engine.controls).toEqual([{ type: "pause" }, { type: "resume" }, { type: "pause" }]);
    stepEvent("step_succeeded", "build");
    await flush();
    stepEvent("step_started", "verify");
    await flush();
    expect(engine.controls.filter((control) => control.type === "pause")).toHaveLength(2);
  });

  it("does not hold the input step, and does nothing unless the definition opts in", async () => {
    const held = await start(carryOn);
    held.stepEvent("step_started", "input");
    await flush();
    expect(held.engine.controls).toEqual([]);

    const optedOut = await start(carryOn, { switches: false });
    optedOut.stepEvent("step_started", "plan");
    optedOut.stepEvent("step_succeeded", "plan");
    await flush();
    expect(optedOut.engine.controls).toEqual([]);
    expect(optedOut.engine.stateRequests).toEqual([]);
  });

  it("hands over: ends the run and settles it with the definition's switched result", async () => {
    const { engine, handle, events, stepEvent } = await start(async () => ({ type: "switch", outcome: { to: "Debug & plan a fix" } }));
    stepEvent("step_started", "plan");
    stepEvent("step_succeeded", "plan");
    await flush();
    expect(engine.controls).toEqual([{ type: "pause" }, { type: "cancel" }]);
    expect(events.filter((event) => event.kind === "workflow_boundary").map((event) => (event as { status: string }).status)).toEqual(["checking", "switch"]);

    // The engine reports the cancelled run; that is a hand-over, not a cancellation.
    engine.emit({ kind: "workflow_finished", data: { state: { status: "cancelled", steps: {} } } });
    expect(await handle.done).toEqual({ status: "completed", result: { response: "switched to Debug & plan a fix" } });
  });

  it("treats a failing decision as carrying on", async () => {
    const { engine, stepEvent } = await start(async () => {
      throw new Error("router down");
    });
    stepEvent("step_started", "plan");
    stepEvent("step_succeeded", "plan");
    await flush();
    expect(engine.controls).toEqual([{ type: "pause" }, { type: "resume" }]);
  });

  it("releases the hold when the step fails, so retries and failure paths are not stuck", async () => {
    let asked = 0;
    const { engine, stepEvent } = await start(async () => {
      asked += 1;
      return { type: "continue" };
    });
    stepEvent("step_started", "plan");
    stepEvent("step_failed", "plan");
    await flush();
    expect(engine.controls).toEqual([{ type: "pause" }, { type: "resume" }]);
    expect(asked).toBe(0);
    // The retry is held again.
    stepEvent("step_started", "plan");
    await flush();
    expect(engine.controls.filter((control) => control.type === "pause")).toHaveLength(2);
  });

  it("ignores a decision that arrives after the run was stopped", async () => {
    let decide!: (decision: WorkflowBoundaryDecision) => void;
    const { engine, handle, stepEvent } = await start(() => new Promise<WorkflowBoundaryDecision>((resolve) => { decide = resolve; }));
    stepEvent("step_started", "plan");
    stepEvent("step_succeeded", "plan");
    await flush();
    handle.cancel();
    expect(await handle.done).toEqual({ status: "cancelled" });
    const before = engine.controls.length;
    decide({ type: "switch", outcome: { to: "x" } });
    await flush();
    expect(engine.controls).toHaveLength(before);
  });

  it("keeps a cancelled run cancelled when nothing was handed over", async () => {
    const { engine, handle } = await start(carryOn);
    engine.emit({ kind: "workflow_finished", data: { state: { status: "cancelled" } } });
    expect(await handle.done).toEqual({ status: "cancelled" });
  });

  it("lets the run go on if ending it for a hand-over fails", async () => {
    const { engine, handle, events, stepEvent } = await start(async () => ({ type: "switch", outcome: { to: "x" } }));
    const original = engine.workflowControl.bind(engine);
    engine.workflowControl = (sessionId, control) => (control.type === "cancel" ? Promise.reject(new Error("engine busy")) : original(sessionId, control));
    stepEvent("step_started", "plan");
    stepEvent("step_succeeded", "plan");
    await flush();
    expect(engine.controls).toEqual([{ type: "pause" }, { type: "resume" }]);
    expect(events).toContainEqual({ kind: "log", message: "Could not hand over: engine busy" });
    engine.emit({ kind: "workflow_finished", data: { state: { status: "completed", final_output: "done" } } });
    expect(await handle.done).toMatchObject({ status: "completed", result: { response: "finished" } });
  });
});

describe("workflow graph helpers", () => {
  it("orders steps along the success edges, then any left over", () => {
    expect(stepOrder(WORKFLOW)).toEqual(["input", "plan", "build", "verify", "output"]);
    const stray = { nodes: [{ id: "input", type: "input" }, { id: "a", type: "agent" }, { id: "z", type: "agent" }], edges: [{ source: "input", target: "a", condition: "on_success" }] };
    expect(stepOrder(stray)).toEqual(["input", "a", "z"]);
    expect(stepOrder(null)).toEqual([]);
  });

  it("lists the agent steps still to run after one", () => {
    expect(remainingAgentSteps(WORKFLOW, "plan")).toEqual(["build", "verify"]);
    expect(remainingAgentSteps(WORKFLOW, "verify")).toEqual([]);
    expect(remainingAgentSteps(WORKFLOW, "nope")).toEqual([]);
  });

  it("reads the finished agent steps' outputs as text, in run order", () => {
    const state = { steps: { build: { status: "succeeded", output: { summary: "ok" } }, plan: { status: "succeeded", output: "the plan" }, verify: { status: "running" } } };
    expect(finishedAgentSteps(WORKFLOW, state)).toEqual([
      { id: "plan", name: "Plan", output: "the plan" },
      { id: "build", name: "Build", output: '{"summary":"ok"}' },
    ]);
    expect(finishedAgentSteps(WORKFLOW, undefined)).toEqual([]);
  });
});
