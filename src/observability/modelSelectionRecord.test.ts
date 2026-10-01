import { describe, expect, it } from "vitest";
import type { FlowDecisionTrace } from "../services/flowRouter";
import { JEV_FLOW_TOOL_NAME, jevFlowRecord } from "./modelSelectionRecord";

const trace = (overrides: Partial<FlowDecisionTrace> = {}): FlowDecisionTrace => ({
  id: "jev_1",
  kind: "message",
  jevModelId: "typesafe/jev-1.13",
  query: "A user is chatting…",
  startedAt: "2026-10-01T10:00:00.000Z",
  finishedAt: "2026-10-01T10:00:01.500Z",
  request: { model: "typesafe/jev-1.13", state: "…" },
  httpStatus: 200,
  response: { answers: {} },
  outcome: "decided",
  choice: "investigate",
  confidence: 0.88,
  ranked: [{ id: "investigate", probability: 0.88 }],
  cost: 0.0002,
  ...overrides,
});

describe("jevFlowRecord", () => {
  it("records a message routing as its own run with one call", () => {
    const record = jevFlowRecord(trace(), { tabId: "agent", workspaceRoot: "/ws" });
    expect(record).toMatchObject({
      id: "jev_1:flow",
      toolName: JEV_FLOW_TOOL_NAME,
      status: "succeeded",
      durationMs: 1500,
      origin: { surface: "agent-tab", tabId: "agent", workspaceId: "/ws", displayLabel: "AUTO flow selection" },
      context: { capability: "agent_chat", model: "typesafe/jev-1.13", provider: "openrouter", requestPrompt: "A user is chatting…" },
      execution: { executor: { kind: "model", purpose: "AUTO flow selection" } },
    });
    expect(record.execution!.steps.map((step) => step.message)).toEqual([
      "Asked typesafe/jev-1.13 which workflow fits the message.",
      "OpenRouter responded with HTTP 200.",
      "Chose investigate with confidence 0.88.",
    ]);
  });

  it("names the workflow a boundary check was made for", () => {
    const record = jevFlowRecord(trace({ kind: "boundary", choice: "continue" }), { workflow: "Plan, build, verify" });
    expect(record.origin.displayLabel).toBe("AUTO flow switching · Plan, build, verify");
    expect(record.execution!.executor).toMatchObject({ purpose: "AUTO flow switching" });
    expect(record.execution!.steps[0].message).toBe('Asked typesafe/jev-1.13 whether "Plan, build, verify" should carry on or hand over.');
  });

  it("records a failure with its reason", () => {
    const record = jevFlowRecord(trace({ outcome: "failed", httpStatus: 503, choice: undefined, error: "Flow routing failed (503)." }), {});
    expect(record.status).toBe("failed");
    expect(record.execution!.steps.map((step) => [step.level, step.message])).toEqual([
      ["info", "Asked typesafe/jev-1.13 which workflow fits the message."],
      ["error", "OpenRouter responded with HTTP 503."],
      ["error", "Flow routing failed (503)."],
    ]);
  });
});
