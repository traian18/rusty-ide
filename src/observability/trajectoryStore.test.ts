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
