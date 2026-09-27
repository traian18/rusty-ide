import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrajectoryStore } from "./trajectoryStore";
import { createContextSnapshot, inferExecutionOrigin } from "./origin";
import { createMemoryPersistence } from "./persistence";

const input = { tabId: "agent", message: "hello", workspaceRoot: "/ws", model: "model", chatHistory: [], customProvider: null, skill: null, mcpServers: [], planOnly: false, vfsOnly: false, lspSettings: {} };
let persistence: ReturnType<typeof createMemoryPersistence>;
let values: Map<string, string>;

function start(store: TrajectoryStore, id = "run") {
  store.start(id, inferExecutionOrigin("agent_chat", input), createContextSnapshot("agent_chat", input));
}
async function reload() {
  const store = new TrajectoryStore(persistence);
  await store.setWorkspace("/ws");
  return store;
}
beforeEach(() => {
  values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  persistence = createMemoryPersistence();
});
describe("run trajectories", () => {
  it("batches thousands of text events without evicting the request context", async () => {
    const store = new TrajectoryStore(persistence); start(store);
    store.append("run", "Model request", { system_prompt: "instructions", messages: ["hello"] });
    const changed = vi.fn(); store.subscribe(changed);
    for (let i = 0; i < 5000; i++) store.append("run", "AssistantTextDelta", {
      AssistantTextDelta: { message_id: "answer", delta: "word " },
    }, { id: `token-${i}`, sequence: i });
    store.finish("run", "completed", {});
    await store.flush();
    const run = (await reload()).getSnapshot().runs[0];
    expect(run.entries[0].source).toBe("Model request");
    const text = run.entries.filter((entry) => entry.source === "AssistantTextDelta");
    expect(text.map((entry) => (entry.payload as { AssistantTextDelta: { delta: string } }).AssistantTextDelta.delta).join("")).toBe("word ".repeat(5000));
    expect(text.reduce((total, entry) => total + entry.eventCount!, 0)).toBe(5000);
    expect(changed.mock.calls.length).toBeLessThan(20);
    expect(run.omittedEntries).toBe(0);
  });
  it("keeps a burst of tool events cheap: bounded notifications and no whole-history re-serialization", async () => {
    const store = new TrajectoryStore(persistence);
    // Fill memory near its budget with other runs' history.
    for (let r = 0; r < 20; r++) {
      store.start(`old-${r}`, { surface: "agent-tab", displayLabel: "Agent" }, { capability: "agent_chat", inputKeys: [], fileReferences: [], mcpServers: [] });
      for (let i = 0; i < 200; i++) store.append(`old-${r}`, "ToolCallCompleted", { output: "x".repeat(400) });
      store.finish(`old-${r}`, "completed", {});
    }
    start(store);
    const changed = vi.fn(); store.subscribe(changed);
    const stringify = vi.spyOn(JSON, "stringify");
    const began = performance.now();
    for (let i = 0; i < 1000; i++) store.append("run", "ToolCallRequested", { call: { id: `c${i}`, name: "read_file", arguments: { path: "a.ts" } } });
    const elapsed = performance.now() - began;
    // One serialization per new entry (its own size), never the whole history.
    expect(stringify.mock.calls.length).toBeLessThan(2_100);
    stringify.mockRestore();
    expect(elapsed).toBeLessThan(1_000);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(changed.mock.calls.length).toBeLessThan(5);
    expect(JSON.stringify(store.getSnapshot().runs).length).toBeLessThanOrEqual(2_100_000);
  });

  it("coalesces consecutive ReasoningDelta events sharing a message_id into one entry", async () => {
    const store = new TrajectoryStore(persistence); start(store);
    for (let i = 0; i < 5; i++) store.append("run", "ReasoningDelta", {
      ReasoningDelta: { message_id: "thought-1", delta: `chunk${i} ` },
    }, { id: `reasoning-${i}`, sequence: i });
    store.finish("run", "completed", {});
    await store.flush();
    const run = (await reload()).getSnapshot().runs[0];
    const reasoning = run.entries.filter((entry) => entry.source === "ReasoningDelta");
    expect(reasoning).toHaveLength(1);
    expect((reasoning[0].payload as { ReasoningDelta: { delta: string } }).ReasoningDelta.delta)
      .toBe("chunk0 chunk1 chunk2 chunk3 chunk4 ");
  });
  it("does not coalesce ReasoningDelta and AssistantTextDelta together, even sharing a message_id", async () => {
    const store = new TrajectoryStore(persistence); start(store);
    store.append("run", "ReasoningDelta", { ReasoningDelta: { message_id: "m1", delta: "thinking " } }, { id: "r-1", sequence: 1 });
    store.append("run", "AssistantTextDelta", { AssistantTextDelta: { message_id: "m1", delta: "answering " } }, { id: "t-1", sequence: 2 });
    store.finish("run", "completed", {});
    await store.flush();
    const run = (await reload()).getSnapshot().runs[0];
    const reasoning = run.entries.filter((entry) => entry.source === "ReasoningDelta");
    const text = run.entries.filter((entry) => entry.source === "AssistantTextDelta");
    expect(reasoning).toHaveLength(1);
    expect(text).toHaveLength(1);
    expect((reasoning[0].payload as { ReasoningDelta: { delta: string } }).ReasoningDelta.delta).toBe("thinking ");
    expect((text[0].payload as { AssistantTextDelta: { delta: string } }).AssistantTextDelta.delta).toBe("answering ");
  });
  it("flushes pending reasoning text when a non-delta event interrupts the stream", async () => {
    const store = new TrajectoryStore(persistence); start(store);
    store.append("run", "ReasoningDelta", { ReasoningDelta: { message_id: "m1", delta: "first segment " } }, { id: "r-1", sequence: 1 });
    store.append("run", "ToolCallRequested", { ToolCallRequested: { call: { id: "c1", name: "tool", arguments: {} } } }, { id: "t-1", sequence: 2 });
    store.append("run", "ReasoningDelta", { ReasoningDelta: { message_id: "m1", delta: "second segment " } }, { id: "r-2", sequence: 3 });
    store.finish("run", "completed", {});
    await store.flush();
    const run = (await reload()).getSnapshot().runs[0];
    const reasoning = run.entries.filter((entry) => entry.source === "ReasoningDelta");
    expect(reasoning).toHaveLength(2);
    expect((reasoning[0].payload as { ReasoningDelta: { delta: string } }).ReasoningDelta.delta).toBe("first segment ");
    expect((reasoning[1].payload as { ReasoningDelta: { delta: string } }).ReasoningDelta.delta).toBe("second segment ");
  });
  it("preserves event order, context, failures and redaction across reload", async () => {
    const store = new TrajectoryStore(persistence); start(store);
    store.append("run", "Model request", { system_prompt: "instructions", messages: ["hello"], apiKey: "never persist" });
    store.append("run", "ToolCallCompleted", { error: "not found" }, { id: "event-1", sequence: 3 });
    store.append("run", "ToolCallCompleted", { error: "not found" }, { id: "event-1", sequence: 3 });
    store.finish("run", "failed", { error: "quota exceeded" });
    await store.flush();
    const run = (await reload()).getSnapshot().runs[0];
    expect(run.status).toBe("failed");
    expect(run.entries.map((e) => e.source)).toEqual(["Model request", "ToolCallCompleted", "Run finished"]);
    expect(run.entries[0].payload).toMatchObject({ apiKey: "[REDACTED]", system_prompt: "instructions" });
    expect(JSON.stringify([...persistence.roots.values()].map((root) => [...root.entries.values()]))).not.toContain("never persist");
  });
  it("marks interrupted sessions and retains runs without tools", async () => {
    const store = new TrajectoryStore(persistence); start(store); await store.flush();
    expect((await reload()).getSnapshot().runs[0].status).toBe("interrupted");
  });
  it("protects active runs from deletion and deletes finished traces from disk", async () => {
    const store = new TrajectoryStore(persistence); start(store); store.remove(() => true);
    expect(store.getSnapshot().runs).toHaveLength(1);
    store.finish("run", "cancelled", {});
    await store.flush();
    store.remove(() => true);
    await Promise.resolve();
    expect((await reload()).getSnapshot().runs).toHaveLength(0);
  });
  it("bounds memory but keeps every entry on disk", async () => {
    const store = new TrajectoryStore(persistence); start(store);
    store.append("run", "Model request", Array.from({ length: 101 }, (_, i) => i));
    expect(store.getSnapshot().runs[0].entries[0].payloadState).toBe("truncated");
    for (let i = 0; i < 140; i++) store.append("run", "output", "a".repeat(16384));
    await store.flush();
    expect(store.getSnapshot().runs[0].omittedEntries).toBeGreaterThan(0);
    expect(JSON.stringify(store.getSnapshot().runs).length).toBeLessThan(2_001_000);
    expect(await persistence.loadTrajectory("/ws", "run")).toHaveLength(141);
  });
  it("migrates legacy localStorage trajectories to disk", async () => {
    const legacy = new TrajectoryStore(createMemoryPersistence()); start(legacy, "legacy-run");
    legacy.append("legacy-run", "Model request", { messages: ["old"] });
    values.set("rusty.run-trajectories.v1", JSON.stringify(legacy.getSnapshot().runs));

    const run = (await reload()).getSnapshot().runs.find((item) => item.id === "legacy-run");
    expect(run?.status).toBe("interrupted");
    expect(run?.entries.map((entry) => entry.source)).toEqual(["Model request"]);
    expect(values.has("rusty.run-trajectories.v1")).toBe(false);
  });
});
