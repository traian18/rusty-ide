import { describe, expect, it } from "vitest";
import type { AgentEvent, AgentEventEnvelope, MutationCommand } from "@rusty/harness-sdk";

import type { CapabilityEvent, InlineChatInput } from "../contract";
import type { HarnessControlPlane } from "../contract/controlPlane";
import { createRecordingHost } from "../testing/recordingHost";
import type { BridgeEvent, CoreEngine, WorkflowControl } from "./engine/CoreEngineClient";
import { CoreHarness, type CoreCapabilityDefinition, type ExecutionAnswerer, type HostToolCall } from "./CoreHarness";
import type { SessionRecipe } from "./SessionRecipe";
import {
  describeWorkflowEvent,
  formatWorkflowOutput,
  stepNames,
  workflowInputFor,
  workflowOutcome,
} from "./workflowRun";

class FakeEngine implements CoreEngine {
  recipes: SessionRecipe[] = [];
  mutations: MutationCommand[] = [];
  started: unknown[] = [];
  controls: WorkflowControl[] = [];
  private listener?: (event: BridgeEvent) => void;

  createSession(recipe: SessionRecipe) {
    this.recipes.push(recipe);
    return Promise.resolve("session-1");
  }
  subscribe(_sessionId: string, onEvent: (event: BridgeEvent) => void) {
    this.listener = onEvent;
    return Promise.resolve();
  }
  mutate(_sessionId: string, command: MutationCommand) {
    this.mutations.push(command);
    return Promise.resolve();
  }
  toolResults: Array<{ sessionId: string; callId: string; outcome: unknown }> = [];
  hostToolResult(sessionId: string, callId: string, outcome: unknown) {
    this.toolResults.push({ sessionId, callId, outcome });
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
  startWorkflow(_sessionId: string, input: unknown) {
    this.started.push(input);
    return Promise.resolve("run-1");
  }
  stepConfigs: Array<{ sessionId: string; stepSessionId: string; params: unknown }> = [];
  configureStepExecution(sessionId: string, stepSessionId: string, params: unknown) {
    this.stepConfigs.push({ sessionId, stepSessionId, params });
    return Promise.resolve();
  }
  workflowControl(_sessionId: string, control: WorkflowControl) {
    this.controls.push(control);
    return Promise.resolve();
  }
  emit(event: BridgeEvent) {
    this.listener?.(event);
  }
}

const WORKFLOW = {
  id: "plan-build",
  nodes: [
    { id: "input", name: "Input", type: "input" },
    { id: "build", name: "Build", type: "agent" },
  ],
};

const definition: CoreCapabilityDefinition<"inline_chat"> = {
  capability: "inline_chat",
  recipe: () => ({ workspace: { root: "/ws", binding: "host" }, integration: "host" }),
  promptText: () => "unused for workflows",
  toResult: () => ({ response: "unused" }),
  usageContext: () => ({ workspaceRoot: "/ws", model: "m" }),
  workflow: () => ({ definition: WORKFLOW, input: { request: "ship it" } }),
  workflowResult: (output) => ({ response: formatWorkflowOutput(output) }),
  hostTools: () => ({
    read_file: async (_args, _signal, _observer, call) => {
      toolCalls.push(call!);
      return { ok: true, output: { content: "smart excerpt" } };
    },
    decide: async (_args, _signal, _observer, call) => {
      await call!.configureExecution({ model: "stronger-model" });
      return { ok: true, output: {} };
    },
  }),
};
const toolCalls: HostToolCall[] = [];

const INPUT = { message: "ship it", workspaceRoot: "/ws" } as unknown as InlineChatInput;
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let sequence = 0;
function stepEnvelope(event: AgentEvent): AgentEventEnvelope {
  sequence += 1;
  return {
    event_id: `e${sequence}`,
    session_id: "step-session",
    agent_id: "step-agent",
    parent_agent_id: null,
    run_id: "step-run",
    agent_sequence: sequence,
    session_sequence: sequence,
    timestamp: new Date().toISOString(),
    visibility: "User",
    event,
  } as AgentEventEnvelope;
}

async function start(permission: "allow" | "never" = "never") {
  const engine = new FakeEngine();
  const harness = new CoreHarness({
    engine,
    controlPlane: { recordUsage: async () => {} } as unknown as HarnessControlPlane,
    executionAnswerer: {} as ExecutionAnswerer,
    definitions: { inline_chat: definition },
  });
  const { host } = createRecordingHost();
  if (permission === "allow") host.requestPermission = (async () => "allow") as never;
  const events: CapabilityEvent<"inline_chat">[] = [];
  const handle = harness.run("inline_chat", INPUT, host, (event) => events.push(event));
  await handle.started;
  await flush();
  return { engine, handle, events };
}

describe("CoreHarness workflow runs", () => {
  it("starts the workflow instead of prompting and reports its output", async () => {
    const { engine, handle, events } = await start();
    expect(engine.recipes[0].workflow).toEqual(WORKFLOW);
    expect(engine.started).toEqual([{ request: "ship it" }]);
    expect(engine.mutations).toEqual([]);

    engine.emit({ kind: "workflow_event", data: { event: { type: "step_started", node_id: "build", attempt: 1 } } });
    engine.emit({
      kind: "workflow_agent_event",
      data: { node_id: "build", attempt: 1, envelope: stepEnvelope({ AssistantTextDelta: { message_id: "m1", delta: "{\"summary\"" } } as AgentEvent) },
    });
    // A step agent finishing is not the run finishing.
    engine.emit({
      kind: "workflow_agent_event",
      data: { node_id: "build", attempt: 1, envelope: stepEnvelope({ Completed: { outcome: "Success" } } as AgentEvent) },
    });
    engine.emit({ kind: "workflow_event", data: { event: { type: "step_succeeded", node_id: "build", attempt: 1 } } });
    engine.emit({ kind: "workflow_finished", data: { state: { status: "completed", final_output: { summary: "Shipped." } } } });

    const outcome = await handle.done;
    expect(outcome).toMatchObject({ status: "completed" });
    expect((outcome as { result: { response: string } }).result.response).toMatch(/^Shipped\./);
    expect(events).toContainEqual({ kind: "log", message: "Step Build…" });
    expect(events).toContainEqual({ kind: "workflow_step", workflowId: "plan-build", nodeId: "build", name: "Build", status: "running", attempt: 1 });
    expect(events).toContainEqual({ kind: "workflow_step", workflowId: "plan-build", nodeId: "build", name: "Build", status: "succeeded", attempt: 1 });
    expect(events.some((event) => event.kind === "token")).toBe(true);
  });

  it("answers step permissions through the workflow", async () => {
    const { engine } = await start("allow");
    engine.emit({
      kind: "workflow_agent_event",
      data: {
        node_id: "build",
        attempt: 1,
        envelope: stepEnvelope({
          PermissionRequested: { request: { id: "perm-1", tool_call: { id: "c1", name: "run_command", arguments: {} } } },
        } as unknown as AgentEvent),
      },
    });
    await flush();
    expect(engine.controls).toEqual([{ type: "resolve_permission", id: "perm-1", decision: "Approved" }]);
    expect(engine.mutations).toEqual([]);
  });

  it("reports failures and cancels through the workflow", async () => {
    const failed = await start();
    failed.engine.emit({
      kind: "workflow_finished",
      data: { state: { status: "failed", error: { code: "verification_failed", message: "Tests did not run." } } },
    });
    expect(await failed.handle.done).toEqual({
      status: "failed",
      error: { code: "verification_failed", message: "Tests did not run." },
    });

    const cancelled = await start();
    cancelled.handle.cancel();
    expect(await cancelled.handle.done).toEqual({ status: "cancelled" });
    expect(cancelled.engine.controls).toEqual([{ type: "cancel" }]);
    expect(cancelled.engine.mutations).toEqual([]);
  });
});

describe("workflow steps' host tools", () => {
  it("serve the step's session and answer on the parent's bridge", async () => {
    toolCalls.length = 0;
    const { engine } = await start();
    engine.emit({
      kind: "host_tool_call",
      data: { call_id: "host-1", tool: "read_file", input: { path: "a.rs", request: "main" }, tool_call_id: "c1", session_id: "step-session" },
    });
    await flush();
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({ sessionId: "step-session", toolCallId: "c1" });
    expect(engine.toolResults).toEqual([
      { sessionId: "session-1", callId: "host-1", outcome: { ok: true, output: { content: "smart excerpt" } } },
    ]);

    // A step-up from inside a step reconfigures that step, not the chat.
    engine.emit({ kind: "host_tool_call", data: { call_id: "host-3", tool: "decide", input: {}, tool_call_id: "c3", session_id: "step-session" } });
    await flush();
    expect(engine.stepConfigs).toEqual([{ sessionId: "session-1", stepSessionId: "step-session", params: { model: "stronger-model" } }]);
    expect(engine.mutations).toEqual([]);

    // A call from the session itself (no step) is filed under it.
    engine.emit({ kind: "host_tool_call", data: { call_id: "host-2", tool: "read_file", input: {}, tool_call_id: "c2" } });
    await flush();
    expect(toolCalls[1].sessionId).toBe("session-1");
  });
});

describe("workflowRun helpers", () => {
  const names = stepNames(WORKFLOW);

  it("names steps and describes retries and failures", () => {
    expect(names).toEqual({ input: "Input", build: "Build" });
    expect(
      describeWorkflowEvent({ event: { type: "step_retry_scheduled", node_id: "build", next_attempt: 2, triggered_by: "verify" } }, names),
    ).toEqual({ log: "verify failed; retrying Build (attempt 2).", step: { nodeId: "build", status: "retry", attempt: 2 } });
    expect(
      describeWorkflowEvent({ event: { type: "step_failed", node_id: "build", attempt: 1, error: { code: "x", message: "boom" } } }, names),
    ).toMatchObject({ step: { status: "failed", message: "boom" } });
    expect(describeWorkflowEvent({ event: { type: "budget_updated" } }, names)).toEqual({});
  });

  it("reads outcomes and formats output", () => {
    expect(workflowOutcome({ status: "cancelled" })).toEqual({ status: "cancelled" });
    expect(workflowOutcome({ status: "failed" })).toMatchObject({ status: "failed", code: "WORKFLOW_FAILED" });
    expect(formatWorkflowOutput("plain")).toBe("plain");
    expect(formatWorkflowOutput({ a: 1 })).toContain("```json");
  });

  it("turns chat messages into workflow input", () => {
    expect(workflowInputFor("fix the bug")).toEqual({ request: "fix the bug", attachments: [] });
    expect(workflowInputFor('{"ticket": 12}')).toEqual({ ticket: 12 });
    expect(workflowInputFor("{not json")).toEqual({ request: "{not json", attachments: [] });
  });
});
