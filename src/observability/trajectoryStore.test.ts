import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrajectoryStore } from "./trajectoryStore";
import { createContextSnapshot, inferExecutionOrigin } from "./origin";

const input = { tabId: "agent", message: "hello", workspaceRoot: "/ws", model: "model", chatHistory: [], customProvider: null, skill: null, mcpServers: [], planOnly: false, vfsOnly: false, lspSettings: {} };
function start(store: TrajectoryStore, id = "run") {
  store.start(id, inferExecutionOrigin("agent_chat", input), createContextSnapshot("agent_chat", input));
}
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
});
describe("run trajectories", () => {
  it("batches thousands of text events without evicting the request context", () => {
    const store = new TrajectoryStore(); start(store);
    store.append("run", "Model request", { system_prompt: "instructions", messages: ["hello"] });
    const changed = vi.fn(); store.subscribe(changed);
    for (let i = 0; i < 5000; i++) store.append("run", "AssistantTextDelta", {
      AssistantTextDelta: { message_id: "answer", delta: "word " },
    }, { id: `token-${i}`, sequence: i });
    store.finish("run", "completed", {});
    const run = new TrajectoryStore().getSnapshot().runs[0];
    expect(run.entries[0].source).toBe("Model request");
    const text = run.entries.filter((entry) => entry.source === "AssistantTextDelta");
    expect(text.map((entry) => (entry.payload as { AssistantTextDelta: { delta: string } }).AssistantTextDelta.delta).join("")).toBe("word ".repeat(5000));
    expect(text.reduce((total, entry) => total + entry.eventCount!, 0)).toBe(5000);
    expect(changed.mock.calls.length).toBeLessThan(20);
    expect(run.omittedEntries).toBe(0);
  });
  it("coalesces consecutive ReasoningDelta events sharing a message_id into one entry", () => {
    const store = new TrajectoryStore(); start(store);
    for (let i = 0; i < 5; i++) store.append("run", "ReasoningDelta", {
      ReasoningDelta: { message_id: "thought-1", delta: `chunk${i} ` },
    }, { id: `reasoning-${i}`, sequence: i });
    store.finish("run", "completed", {});
    const run = new TrajectoryStore().getSnapshot().runs[0];
    const reasoning = run.entries.filter((entry) => entry.source === "ReasoningDelta");
    expect(reasoning).toHaveLength(1);
    expect((reasoning[0].payload as { ReasoningDelta: { delta: string } }).ReasoningDelta.delta)
      .toBe("chunk0 chunk1 chunk2 chunk3 chunk4 ");
  });
  it("does not coalesce ReasoningDelta and AssistantTextDelta together, even sharing a message_id", () => {
    const store = new TrajectoryStore(); start(store);
    store.append("run", "ReasoningDelta", { ReasoningDelta: { message_id: "m1", delta: "thinking " } }, { id: "r-1", sequence: 1 });
    store.append("run", "AssistantTextDelta", { AssistantTextDelta: { message_id: "m1", delta: "answering " } }, { id: "t-1", sequence: 2 });
    store.finish("run", "completed", {});
    const run = new TrajectoryStore().getSnapshot().runs[0];
    const reasoning = run.entries.filter((entry) => entry.source === "ReasoningDelta");
    const text = run.entries.filter((entry) => entry.source === "AssistantTextDelta");
    expect(reasoning).toHaveLength(1);
    expect(text).toHaveLength(1);
    expect((reasoning[0].payload as { ReasoningDelta: { delta: string } }).ReasoningDelta.delta).toBe("thinking ");
    expect((text[0].payload as { AssistantTextDelta: { delta: string } }).AssistantTextDelta.delta).toBe("answering ");
  });
  it("flushes pending reasoning text when a non-delta event interrupts the stream", () => {
    const store = new TrajectoryStore(); start(store);
    store.append("run", "ReasoningDelta", { ReasoningDelta: { message_id: "m1", delta: "first segment " } }, { id: "r-1", sequence: 1 });
    store.append("run", "ToolCallRequested", { ToolCallRequested: { call: { id: "c1", name: "tool", arguments: {} } } }, { id: "t-1", sequence: 2 });
    store.append("run", "ReasoningDelta", { ReasoningDelta: { message_id: "m1", delta: "second segment " } }, { id: "r-2", sequence: 3 });
    store.finish("run", "completed", {});
    const run = new TrajectoryStore().getSnapshot().runs[0];
    const reasoning = run.entries.filter((entry) => entry.source === "ReasoningDelta");
    expect(reasoning).toHaveLength(2);
    expect((reasoning[0].payload as { ReasoningDelta: { delta: string } }).ReasoningDelta.delta).toBe("first segment ");
    expect((reasoning[1].payload as { ReasoningDelta: { delta: string } }).ReasoningDelta.delta).toBe("second segment ");
  });
  it("preserves event order, context, failures and redaction across reload", () => {
    const store = new TrajectoryStore(); start(store);
    store.append("run", "Model request", { system_prompt: "instructions", messages: ["hello"], apiKey: "never persist" });
    store.append("run", "ToolCallCompleted", { error: "not found" }, { id: "event-1", sequence: 3 });
    store.append("run", "ToolCallCompleted", { error: "not found" }, { id: "event-1", sequence: 3 });
    store.finish("run", "failed", { error: "quota exceeded" });
    const run = new TrajectoryStore().getSnapshot().runs[0];
    expect(run.status).toBe("failed");
    expect(run.entries.map((e) => e.source)).toEqual(["Model request", "ToolCallCompleted", "Run finished"]);
    expect(run.entries[0].payload).toMatchObject({ apiKey: "[REDACTED]", system_prompt: "instructions" });
    expect(localStorage.getItem("rusty.run-trajectories.v1")).not.toContain("never persist");
  });
  it("marks interrupted sessions and retains runs without tools", () => {
    const store = new TrajectoryStore(); start(store); store.flush();
    expect(new TrajectoryStore().getSnapshot().runs[0].status).toBe("interrupted");
  });
  it("protects active runs from deletion and deletes finished traces", () => {
    const store = new TrajectoryStore(); start(store); store.remove(() => true);
    expect(store.getSnapshot().runs).toHaveLength(1);
    store.finish("run", "cancelled", {}); store.remove(() => true);
    expect(new TrajectoryStore().getSnapshot().runs).toHaveLength(0);
  });
  it("exposes truncated arrays and storage eviction", () => {
    const store = new TrajectoryStore(); start(store);
    store.append("run", "Model request", Array.from({ length: 101 }, (_, i) => i));
    expect(store.getSnapshot().runs[0].entries[0].payloadState).toBe("truncated");
    for (let i = 0; i < 140; i++) store.append("run", "output", "a".repeat(16384));
    store.flush();
    expect(store.getSnapshot().runs[0].omittedEntries).toBeGreaterThan(0);
    expect(localStorage.getItem("rusty.run-trajectories.v1")!.length).toBeLessThan(2_001_000);
  });
});
