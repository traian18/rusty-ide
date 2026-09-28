import { describe, expect, it, vi } from "vitest";
import type { AgentEventEnvelope } from "@rusty/harness-sdk";
import { JevShadowGate, MAX_QUEUED, buildActionState, parseActionAnswer } from "./jevShadowGate";
import { JevShadowStats, summarizeJevShadowByModel, type JevShadowEntry } from "./jevShadowStats";
import type { postJevDecision } from "./intelligentModelSelector";

function envelope(event: unknown, agentId = "agent-1"): AgentEventEnvelope {
  return { session_id: "s1", agent_id: agentId, event } as unknown as AgentEventEnvelope;
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

function scoreResponse(probabilities: Record<string, number>, confidence = 0.8) {
  return {
    status: 200,
    ok: true,
    text: "",
    result: { answers: { action: { type: "score", confidence, probabilities } }, usage: { cost: 0.001 } },
  };
}

function setup(options: { enabled?: boolean; post?: ReturnType<typeof vi.fn> } = {}) {
  const stats = new JevShadowStats(memoryStorage());
  const record = vi.fn();
  const post = options.post ?? vi.fn(async () => scoreResponse({ "0": 0.1, "1": 0.8, "2": 0.1 }));
  const gate = new JevShadowGate({
    config: () => (options.enabled === false ? undefined : { apiKey: "or-key", jevModelId: "typesafe/jev-1.13" }),
    stats,
    record,
    post: post as unknown as typeof postJevDecision,
    sleep: async () => {},
  });
  gate.beginSession("run-1", "s1", { capability: "agent_chat", prompt: "Rename foo to bar in utils.ts", model: "cheap/model" });
  return { gate, stats, record, post };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("JevShadowGate", () => {
  it("scores each tool call with the request, prior actions, and the model's own lead-in", async () => {
    const { gate, stats, record, post } = setup();

    gate.observe("run-1", envelope({ UsageUpdated: { usage: { model: "weak/model-7b" } } }));
    gate.observe("run-1", envelope({ ToolCallRequested: { call: { id: "c1", name: "read_file", arguments: { path: "utils.ts" } } } }));
    gate.observe("run-1", envelope({ ToolCallCompleted: { call_id: "c1", result: { has_error: false, output_preview: "export function foo() {}" } } }));
    gate.observe("run-1", envelope({ AssistantTextDelta: { message_id: "m1", delta: "Now I will delete the file." } }));
    gate.observe("run-1", envelope({ ToolCallRequested: { call: { id: "c2", name: "delete_file", arguments: { path: "utils.ts" } } } }));
    await flush();

    expect(post).toHaveBeenCalledTimes(2);
    const [apiKey, body] = post.mock.calls[1] as [string, { model: string; state: string; questions: { action: { type: string; criteria: string[] } } }];
    expect(apiKey).toBe("or-key");
    expect(body.model).toBe("typesafe/jev-1.13");
    expect(body.questions.action.type).toBe("score");
    expect(body.questions.action.criteria).toHaveLength(3);
    expect(body.state).toContain("Rename foo to bar in utils.ts");
    expect(body.state).toContain("read_file");
    expect(body.state).toContain("succeeded: export function foo() {}");
    expect(body.state).toContain("Now I will delete the file.");
    expect(body.state).toMatch(/Tool: delete_file\nArguments: \{"path":"utils.ts"\}$/);

    const entry = stats.getEntries().find((candidate) => candidate.id === "s1:c2");
    expect(entry).toMatchObject({ model: "weak/model-7b", tool: "delete_file", verdict: "revise", confidence: 0.8, cost: 0.001 });
    expect(record).toHaveBeenCalledWith("run-1", "s1", "c2", "warn", expect.stringContaining("Revise"), expect.anything());
  });

  it("attaches the tool's outcome whether it finishes before or after JEV answers", async () => {
    let answer!: (value: unknown) => void;
    const post = vi.fn(() => new Promise((resolve) => (answer = resolve)));
    const { gate, stats } = setup({ post });

    gate.observe("run-1", envelope({ ToolCallRequested: { call: { id: "c1", name: "shell", arguments: { command: "rm -rf build" } } } }));
    gate.observe("run-1", envelope({ ToolCallCompleted: { call_id: "c1", result: { has_error: true, output_preview: "permission denied" } } }));
    answer(scoreResponse({ "0": 0.1, "1": 0.2, "2": 0.7 }));
    await flush();

    expect(stats.getEntries()[0]).toMatchObject({ model: "cheap/model", verdict: "stop", toolOutcome: "failed" });
  });

  it("does not score decide calls, which are JEV's own decisions", async () => {
    const { gate, stats, post } = setup();
    gate.observe("run-1", envelope({ ToolCallRequested: { call: { id: "c1", name: "decide", arguments: { question: "Which fix?" } } } }));
    gate.observe("run-1", envelope({ ToolCallRequested: { call: { id: "c2", name: "write_file", arguments: { path: "a.ts" } } } }));
    await flush();

    expect(post).toHaveBeenCalledTimes(1);
    expect(stats.getEntries().map((entry) => entry.tool)).toEqual(["write_file"]);
    const body = (post.mock.calls[0] as unknown[])[1] as { state: string };
    expect(body.state).toContain("Called decide");
  });

  it("describes what the calling agent did before a tool call, even while scoring is off", () => {
    const { gate } = setup({ enabled: false });
    gate.observe("run-1", envelope({ ToolCallRequested: { call: { id: "c1", name: "read_file", arguments: { path: "a.ts" } } } }));
    gate.observe("run-1", envelope({ ToolCallCompleted: { call_id: "c1", result: { has_error: false, output_preview: "ok" } } }));
    gate.observe("run-1", { ...envelope({ ToolCallRequested: { call: { id: "k1", name: "read_file", arguments: { path: "child.ts" } } } }, "child-1"), parent_agent_id: "agent-1" } as AgentEventEnvelope);
    gate.observe("run-1", envelope({ ToolCallRequested: { call: { id: "d1", name: "decide", arguments: {} } } }));
    gate.observe("run-1", envelope({ ToolCallRequested: { call: { id: "c2", name: "write_file", arguments: { path: "a.ts" } } } }));

    const before = gate.describeHistoryBefore("run-1", "s1", "d1");
    expect(before).toContain("1. Called read_file");
    expect(before).toContain("succeeded: ok");
    expect(before).not.toContain("child.ts");
    expect(before).not.toContain("write_file");
  });

  it("falls back to everything the top-level agent did when the call's event has not arrived yet", () => {
    const { gate } = setup({ enabled: false });
    gate.observe("run-1", { ...envelope({ ToolCallRequested: { call: { id: "k1", name: "list_files", arguments: {} } } }, "child-1"), parent_agent_id: "agent-1" } as AgentEventEnvelope);
    gate.observe("run-1", envelope({ ToolCallRequested: { call: { id: "c1", name: "read_file", arguments: { path: "a.ts" } } } }));

    const before = gate.describeHistoryBefore("run-1", "s1", "not-yet-seen");
    expect(before).toContain("read_file");
    expect(before).not.toContain("list_files");
    expect(gate.describeHistoryBefore("other-run", "s1", "d1")).toBeUndefined();
  });

  it("reports the calling agent's later finished calls until the listener stops", () => {
    const { gate } = setup({ enabled: false });
    const seen: unknown[] = [];
    gate.observe("run-1", envelope({ ToolCallRequested: { call: { id: "d1", name: "decide", arguments: {} } } }));
    gate.watchFollowUp("run-1", "s1", "d1", (call) => {
      seen.push(call);
      return seen.length < 2;
    });
    gate.observe("run-1", envelope({ ToolCallCompleted: { call_id: "d1", result: { has_error: false } } }));
    for (const [id, failed] of [["c1", false], ["c2", true], ["c3", false]] as const) {
      gate.observe("run-1", envelope({ ToolCallRequested: { call: { id, name: "write_file", arguments: {} } } }));
      gate.observe("run-1", envelope({ ToolCallCompleted: { call_id: id, result: { has_error: failed } } }));
    }

    expect(seen).toEqual([
      { callId: "c1", tool: "write_file", failed: false },
      { callId: "c2", tool: "write_file", failed: true },
    ]);
  });

  it("does nothing while the gate is off", async () => {
    const { gate, stats, post } = setup({ enabled: false });
    gate.observe("run-1", envelope({ ToolCallRequested: { call: { id: "c1", name: "read_file", arguments: {} } } }));
    gate.observe("run-1", envelope({ ToolCallCompleted: { call_id: "c1", result: { has_error: false } } }));
    await flush();
    expect(post).not.toHaveBeenCalled();
    expect(stats.getEntries()).toEqual([]);
  });

  it("records a failure instead of throwing when JEV cannot answer", async () => {
    const post = vi.fn(async () => ({ status: 500, ok: false, text: "boom", result: undefined }));
    const { gate, stats, record } = setup({ post });
    gate.observe("run-1", envelope({ ToolCallRequested: { call: { id: "c1", name: "read_file", arguments: {} } } }));
    await flush();
    expect(stats.getEntries()[0].error).toBe("JEV request failed (HTTP 500).");
    expect(stats.getEntries()[0].verdict).toBeUndefined();
    expect(record).toHaveBeenCalledWith("run-1", "s1", "c1", "warn", expect.stringContaining("HTTP 500"), expect.anything());
  });

  it("queues calls beyond the open-request limit and scores them as slots free up", async () => {
    const answers: Array<(value: unknown) => void> = [];
    const post = vi.fn(() => new Promise((resolve) => answers.push(resolve)));
    const { gate, stats } = setup({ post });
    for (let index = 0; index < 6; index += 1) {
      gate.observe("run-1", envelope({ ToolCallRequested: { call: { id: `c${index}`, name: "read_file", arguments: {} } } }));
    }
    expect(post).toHaveBeenCalledTimes(4);
    expect(stats.getEntries().some((entry) => entry.error)).toBe(false);

    answers.splice(0).forEach((answer) => answer(scoreResponse({ "0": 0.9, "1": 0.05, "2": 0.05 })));
    await flush();
    expect(post).toHaveBeenCalledTimes(6);
    answers.splice(0).forEach((answer) => answer(scoreResponse({ "0": 0.9, "1": 0.05, "2": 0.05 })));
    await flush();
    expect(stats.getEntries().map((entry) => entry.verdict)).toEqual(Array(6).fill("proceed"));
  });

  it("leaves calls unscored only once the queue itself is full", async () => {
    const post = vi.fn(() => new Promise(() => {}));
    const { gate, stats } = setup({ post });
    for (let index = 0; index < 4 + MAX_QUEUED + 3; index += 1) {
      gate.observe("run-1", envelope({ ToolCallRequested: { call: { id: `c${index}`, name: "read_file", arguments: {} } } }));
    }
    expect(stats.getEntries().filter((entry) => entry.error?.startsWith("Skipped"))).toHaveLength(3);
  });

  it("retries transient failures before giving up on a call", async () => {
    const post = vi.fn()
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce({ status: 429, ok: false, text: "slow down" })
      .mockResolvedValueOnce(scoreResponse({ "0": 0.9, "1": 0.05, "2": 0.05 }));
    const { gate, stats } = setup({ post });
    gate.observe("run-1", envelope({ ToolCallRequested: { call: { id: "c1", name: "read_file", arguments: {} } } }));
    await flush();
    await flush();

    expect(post).toHaveBeenCalledTimes(3);
    expect(stats.getEntries()[0]).toMatchObject({ verdict: "proceed" });
    expect(stats.getEntries()[0].error).toBeUndefined();
  });

  it("does not retry a request JEV rejected as invalid", async () => {
    const post = vi.fn(async () => ({ status: 400, ok: false, text: "bad request" }));
    const { gate, stats } = setup({ post });
    gate.observe("run-1", envelope({ ToolCallRequested: { call: { id: "c1", name: "read_file", arguments: {} } } }));
    await flush();
    expect(post).toHaveBeenCalledTimes(1);
    expect(stats.getEntries()[0].error).toBe("JEV request failed (HTTP 400).");
  });

  it("ignores sessions it was never told about and forgets runs that ended", async () => {
    const { gate, post } = setup();
    gate.endRun("run-1");
    gate.observe("run-1", envelope({ ToolCallRequested: { call: { id: "c1", name: "read_file", arguments: {} } } }));
    gate.observe("run-2", envelope({ ToolCallRequested: { call: { id: "c1", name: "read_file", arguments: {} } } }));
    await flush();
    expect(post).not.toHaveBeenCalled();
  });
});

describe("buildActionState", () => {
  it("keeps the newest actions when the history is too long", () => {
    const history = Array.from({ length: 200 }, (_, index) => ({
      tool: "read_file",
      arguments: JSON.stringify({ path: `file-${index}.ts` }),
      outcome: { failed: false, preview: "x".repeat(100) },
    }));
    const state = buildActionState({ prompt: "p", history, thought: "", tool: "edit", arguments: "{}" });
    expect(state).toContain("file-199.ts");
    expect(state).not.toContain("file-0.ts");
    expect(state).toMatch(/\[\d+ earlier actions omitted\]/);
    expect(state.length).toBeLessThan(16_000);
  });
});

describe("parseActionAnswer", () => {
  it("rejects answers that are not a score", () => {
    expect(parseActionAnswer({ answers: { action: { type: "choice", confidence: 0.9, probabilities: { "0": 1 } } } })).toBeUndefined();
    expect(parseActionAnswer({ answers: { action: { type: "score", confidence: 0.9, probabilities: {} } } })).toBeUndefined();
    expect(parseActionAnswer(undefined)).toBeUndefined();
  });
});

describe("summarizeJevShadowByModel", () => {
  it("compares failure rates of calls JEV let proceed against calls it flagged", () => {
    const base = { at: "", runId: "r", capability: "agent_chat", tool: "t" };
    const entries: JevShadowEntry[] = [
      { ...base, id: "1", model: "weak", verdict: "proceed", confidence: 0.9, toolOutcome: "succeeded", cost: 0.001 },
      { ...base, id: "2", model: "weak", verdict: "proceed", confidence: 0.7, toolOutcome: "failed", cost: 0.001 },
      { ...base, id: "3", model: "weak", verdict: "revise", confidence: 0.6, toolOutcome: "failed", cost: 0.001 },
      { ...base, id: "4", model: "weak", verdict: "stop", confidence: 0.8 },
      { ...base, id: "5", model: "weak", error: "JEV request failed (HTTP 500)." },
      { ...base, id: "6", model: "strong", verdict: "proceed", confidence: 1, toolOutcome: "succeeded" },
    ];
    const [weak, strong] = summarizeJevShadowByModel(entries);
    expect(weak).toMatchObject({
      model: "weak",
      scored: 4,
      errors: 1,
      verdicts: { proceed: 2, revise: 1, stop: 1 },
      proceedFinished: 2,
      proceedFailed: 1,
      flaggedFinished: 1,
      flaggedFailed: 1,
    });
    expect(weak.averageConfidence).toBeCloseTo(0.75);
    expect(weak.cost).toBeCloseTo(0.003);
    expect(strong.scored).toBe(1);
  });
});
