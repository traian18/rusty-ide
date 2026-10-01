import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrajectoryStore } from "./trajectoryStore";
import { createContextSnapshot, inferExecutionOrigin } from "./origin";
import { createMemoryPersistence } from "./persistence";

const input = { tabId: "agent", message: "hello", workspaceRoot: "/ws", model: "model", chatHistory: [], customProvider: null, skill: null, mcpServers: [], planOnly: false, vfsOnly: false, lspSettings: {} };
let persistence: ReturnType<typeof createMemoryPersistence>;

function start(store: TrajectoryStore, id = "run") {
  store.start(id, inferExecutionOrigin("agent_chat", input), createContextSnapshot("agent_chat", input));
}
async function reload(loadEntries = true) {
  const store = new TrajectoryStore(persistence);
  await store.setWorkspace("/ws");
  if (loadEntries) await Promise.all(store.getSnapshot().runs.map((run) => store.ensureEntries(run.id)));
  return store;
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  persistence = createMemoryPersistence();
});

describe("run trajectories", () => {
  it("loads historical metadata lazily and de-duplicates demand loads", async () => {
    const original = new TrajectoryStore(persistence); start(original);
    original.append("run", "Model request", { messages: ["hello"] });
    original.finish("run", "completed", {}); await original.flush();
    const loadTrajectory = vi.spyOn(persistence, "loadTrajectory");
    const store = await reload(false);
    expect(store.getSnapshot().runs[0].entries).toEqual([]);
    expect(loadTrajectory).not.toHaveBeenCalled();
    await Promise.all([store.ensureEntries("run"), store.ensureEntries("run")]);
    expect(loadTrajectory).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().runs[0].entries).toHaveLength(2);
  });

  it("represents demand-load errors and permits a retry", async () => {
    const original = new TrajectoryStore(persistence); start(original); original.finish("run", "completed", {}); await original.flush();
    const failure = vi.spyOn(persistence, "loadTrajectory").mockRejectedValueOnce(new Error("trace unavailable"));
    const store = await reload(false);
    await store.ensureEntries("run");
    expect(store.getSnapshot().entryErrors.get("run")).toBe("trace unavailable");
    failure.mockRestore();
    await store.ensureEntries("run");
    expect(store.getSnapshot().entryErrors.has("run")).toBe(false);
  });

  it("coalesces streaming deltas and keeps text sources separate", async () => {
    const store = new TrajectoryStore(persistence); start(store);
    for (let i = 0; i < 5; i++) store.append("run", "ReasoningDelta", { ReasoningDelta: { message_id: "thought", delta: `chunk${i} ` } }, { sequence: i });
    store.append("run", "AssistantTextDelta", { AssistantTextDelta: { message_id: "thought", delta: "answer " } }, { sequence: 6 });
    store.finish("run", "completed", {}); await store.flush();
    const run = (await reload()).getSnapshot().runs[0];
    expect(run.entries.filter((entry) => entry.source === "ReasoningDelta")).toHaveLength(1);
    expect(run.entries.filter((entry) => entry.source === "AssistantTextDelta")).toHaveLength(1);
  });

  it("avoids whole-history serialization and enforces the approximate memory guard", async () => {
    const store = new TrajectoryStore(persistence); start(store);
    const stringify = vi.spyOn(JSON, "stringify");
    for (let i = 0; i < 140; i++) store.append("run", "output", "a".repeat(16384));
    expect(stringify.mock.calls.length).toBeLessThan(300);
    stringify.mockRestore();
    await store.flush();
    expect(store.getSnapshot().runs[0].omittedEntries).toBeGreaterThan(0);
    expect(JSON.stringify(store.getSnapshot().runs).length).toBeLessThan(2_001_000);
    expect(await persistence.loadTrajectory("/ws", "run")).toHaveLength(140);
  });

  it("preserves order and redaction across persistence", async () => {
    const store = new TrajectoryStore(persistence); start(store);
    store.append("run", "Model request", { apiKey: "never persist" });
    store.append("run", "ToolCallCompleted", { error: "not found" }, { id: "event-1", sequence: 3 });
    store.append("run", "ToolCallCompleted", { error: "not found" }, { id: "event-1", sequence: 3 });
    store.finish("run", "failed", {}); await store.flush();
    const run = (await reload()).getSnapshot().runs[0];
    expect(run.entries.map((entry) => entry.source)).toEqual(["Model request", "ToolCallCompleted", "Run finished"]);
    expect(run.entries[0].payload).toMatchObject({ apiKey: "[REDACTED]" });
  });
});
