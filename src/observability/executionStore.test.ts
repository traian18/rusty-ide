import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AgentEvent, AgentEventEnvelope } from "@rusty/harness-sdk";
import { ExecutionObservabilityStore } from "./executionStore";
import { createMemoryPersistence, type ObservabilityPersistence } from "./persistence";
import { sanitizeForObservability } from "./redaction";
import { TrajectoryStore } from "./trajectoryStore";

const INPUT = {
  tabId: "agent",
  message: "hello",
  workspaceRoot: "/workspace",
  model: "model-a",
  chatHistory: [],
  mcpServers: [],
  customProvider: { id: "provider-a", apiKey: "must-not-persist" },
  skill: null,
  planOnly: false,
  vfsOnly: false,
  lspSettings: {},
};

function envelope(event: AgentEvent, sequence: number, parentAgentId: string | null = null): AgentEventEnvelope {
  return {
    event_id: `event-${sequence}`,
    session_id: "session-1",
    agent_id: "agent-1",
    parent_agent_id: parentAgentId,
    run_id: "core-run-1",
    agent_sequence: sequence,
    session_sequence: sequence,
    timestamp: new Date(2_000_000_000_000 + sequence * 1_000).toISOString(),
    visibility: "User",
    event,
  };
}

const STUCK_RECORD = {
  id: "session-1:call-stuck",
  callId: "call-stuck",
  ideRunId: "stuck-run",
  toolName: "bash.exec",
  status: "running",
  requestedAt: new Date(Date.now() - 60_000).toISOString(),
  startedAt: new Date(Date.now() - 50_000).toISOString(),
  origin: { surface: "agent", displayLabel: "Agent" },
  context: { capability: "agent_chat", workspaceRoot: "/workspace" },
  payloadState: "full",
};

describe("executionObservability", () => {
  let executionObservability: ExecutionObservabilityStore;
  let persistence: ReturnType<typeof createMemoryPersistence>;
  const storeWith = (p: ObservabilityPersistence = persistence) => new ExecutionObservabilityStore(p, new TrajectoryStore(p));
  const diskText = () => JSON.stringify([...persistence.roots.values()].map((root) => root.executions));

  beforeAll(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
        key: (index: number) => [...values.keys()][index] ?? null,
        get length() { return values.size; },
      } satisfies Storage,
    });
  });

  beforeEach(() => {
    localStorage.clear();
    persistence = createMemoryPersistence();
    executionObservability = storeWith();
  });

  it("projects a structured core tool lifecycle and redacts secrets before persistence", async () => {
    executionObservability.startRun("ide-run", "agent_chat", INPUT, { displayLabel: "Agent" });
    executionObservability.ingest("ide-run", envelope({
      ToolCallRequested: { call: { id: "call-1", name: "http.request", arguments: { url: "https://example.test", authorization: "Bearer secret-value-123456" } } },
    }, 1));
    executionObservability.ingest("ide-run", envelope({ ToolCallStarted: { call_id: "call-1" } }, 2));
    executionObservability.ingest("ide-run", envelope({ ToolCallProgress: { call_id: "call-1", progress: { status: "fetching", fraction: 0.5 } } }, 3));
    executionObservability.ingest("ide-run", envelope({ ToolCallCompleted: { call_id: "call-1", result: { has_error: false, output_preview: "done" } } }, 4));

    const [record] = executionObservability.getSnapshot().records;
    expect(record).toMatchObject({ toolName: "http.request", status: "succeeded", callId: "call-1", agentId: "agent-1" });
    expect(record.progress).toEqual({ status: "fetching", fraction: 0.5 });
    expect(record.arguments).toEqual({ url: "https://example.test", authorization: "[REDACTED]" });
    await executionObservability.flush();
    expect(diskText()).toContain("http.request");
    expect(diskText()).not.toContain("secret-value");
    expect(localStorage.getItem("rusty.execution-observability.v1")).toBeNull();
  });

  it("marks active calls cancelled with their enclosing IDE run", () => {
    executionObservability.startRun("ide-run", "agent_chat", INPUT);
    executionObservability.ingest("ide-run", envelope({
      ToolCallRequested: { call: { id: "call-1", name: "workspace.read", arguments: { path: "README.md" } } },
    }, 1));
    executionObservability.finishRun("ide-run", { status: "cancelled" });
    expect(executionObservability.getSnapshot().records[0].status).toBe("cancelled");
  });

  it("keeps parallel calls distinct and treats replayed requests idempotently", () => {
    executionObservability.startRun("ide-run", "agent_chat", INPUT);
    const first = envelope({ ToolCallRequested: { call: { id: "call-1", name: "first", arguments: {} } } }, 1);
    executionObservability.ingest("ide-run", first);
    executionObservability.ingest("ide-run", first);
    executionObservability.ingest("ide-run", envelope({ ToolCallRequested: { call: { id: "call-2", name: "second", arguments: {} } } }, 2, "parent-agent"));
    executionObservability.ingest("ide-run", envelope({ ToolCallStarted: { call_id: "call-1" } }, 3));

    const records = executionObservability.getSnapshot().records;
    expect(records).toHaveLength(2);
    expect(records.find((record) => record.callId === "call-1")?.status).toBe("running");
    expect(records.find((record) => record.callId === "call-2")?.status).toBe("queued");
    expect(records.find((record) => record.callId === "call-2")?.parentAgentId).toBe("parent-agent");
    executionObservability.finishRun("ide-run", { status: "completed", result: { response: "", modifiedFiles: [], subagents: [] } });
  });

  it("supports scoped and complete cache deletion, on disk too", async () => {
    executionObservability.startRun("ide-run", "agent_chat", INPUT);
    executionObservability.ingest("ide-run", envelope({
      ToolCallRequested: { call: { id: "call-1", name: "workspace.read", arguments: {} } },
    }, 1));
    executionObservability.ingest("ide-run", envelope({
      ToolCallCompleted: { call_id: "call-1", result: { has_error: false, output_preview: "done" } },
    }, 2));
    await executionObservability.flush();
    await executionObservability.deleteSession("session-1");
    expect(executionObservability.getSnapshot().records).toEqual([]);

    const reloaded = storeWith();
    await reloaded.setWorkspace("/workspace");
    expect(reloaded.getSnapshot().records).toEqual([]);
  });

  it("heals stale active calls on load so processes do not remain stuck in running", async () => {
    await persistence.append("/workspace", "executions", [STUCK_RECORD]);

    const freshStore = storeWith();
    await freshStore.setWorkspace("/workspace");
    const records = freshStore.getSnapshot().records;
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("failed");
    expect(records[0].resultPreview).toContain("Interrupted");
    expect(records[0].durationMs).toBeGreaterThan(0);

    await freshStore.flush();
    const again = storeWith();
    await again.setWorkspace("/workspace");
    expect(again.getSnapshot().records[0].status).toBe("failed");
  });

  it("clears history including stuck calls when there is no active in-memory run", async () => {
    await persistence.append("/workspace", "executions", [STUCK_RECORD]);
    const freshStore = storeWith();
    await freshStore.setWorkspace("/workspace");
    await freshStore.clear();
    expect(freshStore.getSnapshot().records).toEqual([]);

    const reloaded = storeWith();
    await reloaded.setWorkspace("/workspace");
    expect(reloaded.getSnapshot().records).toEqual([]);
  });

  it("restores saved history from disk in a new store", async () => {
    executionObservability.startRun("ide-run", "agent_chat", INPUT);
    executionObservability.ingest("ide-run", envelope({
      ToolCallRequested: { call: { id: "call-1", name: "workspace.read", arguments: {} } },
    }, 1));
    executionObservability.ingest("ide-run", envelope({
      ToolCallCompleted: { call_id: "call-1", result: { has_error: false, output_preview: "done" } },
    }, 2));
    await executionObservability.flush();

    const restored = storeWith();
    await restored.setWorkspace("/workspace");
    expect(restored.getSnapshot().records).toHaveLength(1);
    expect(restored.getSnapshot().records[0]).toMatchObject({ callId: "call-1", status: "succeeded" });
    expect(restored.getSnapshot().storageBytes).toBeGreaterThan(0);
  });

  it("migrates legacy localStorage history to disk and frees the quota", async () => {
    localStorage.setItem("rusty.execution-observability.v1", JSON.stringify([STUCK_RECORD]));
    const store = storeWith();
    await store.setWorkspace("/workspace");
    expect(localStorage.getItem("rusty.execution-observability.v1")).toBeNull();
    expect(store.getSnapshot().records).toMatchObject([{ callId: "call-stuck", status: "failed" }]);

    localStorage.setItem("rusty.execution-observability.v1", "not-json");
    const degraded = storeWith(createMemoryPersistence());
    await degraded.setWorkspace("/workspace");
    expect(degraded.getSnapshot().records).toEqual([]);
    expect(localStorage.getItem("rusty.execution-observability.v1")).toBeNull();
  });

  it("keeps unsaved records and retries after a disk write failure", async () => {
    let failing = true;
    const flaky: ObservabilityPersistence = {
      ...persistence,
      append: async (...args) => {
        if (failing) throw new Error("disk full");
        return persistence.append(...args);
      },
    };
    const store = storeWith(flaky);
    store.startRun("ide-run", "agent_chat", INPUT);
    store.ingest("ide-run", envelope({ ToolCallRequested: { call: { id: "call-1", name: "workspace.read", arguments: {} } } }, 1));
    await store.flush();
    expect(store.getSnapshot().lastError).toBe("disk full");
    expect(store.getSnapshot().records).toHaveLength(1);

    failing = false;
    await store.flush();
    expect(store.getSnapshot().lastError).toBeUndefined();
    expect(diskText()).toContain("call-1");
  });

  it("never deletes disk history when the view window shrinks", async () => {
    const old = { ...STUCK_RECORD, id: "old", status: "succeeded", requestedAt: new Date(Date.now() - 60 * 86_400_000).toISOString() };
    await persistence.append("/workspace", "executions", [old]);
    const store = storeWith();
    await store.setRetention(null);
    await store.setWorkspace("/workspace");
    expect(store.getSnapshot().records.map((record) => record.id)).toEqual(["old"]);

    await store.setRetention(7);
    expect(store.getSnapshot().records).toEqual([]);
    await store.setRetention(null);
    expect(store.getSnapshot().records.map((record) => record.id)).toEqual(["old"]);
  });

  it("bounds a tool payload before writing it to the local cache", () => {
    executionObservability.startRun("ide-run", "agent_chat", INPUT);
    executionObservability.ingest("ide-run", envelope({
      ToolCallRequested: { call: { id: "call-large", name: "large", arguments: { chunks: Array.from({ length: 20 }, () => "x".repeat(10_000)) } } },
    }, 1));
    const [record] = executionObservability.getSnapshot().records;
    expect(record.payloadState).toBe("truncated");
    expect(JSON.stringify(record.arguments).length).toBeLessThan(70_000);
  });

  it("turns non-JSON primitives into safe previews instead of throwing", () => {
    expect(sanitizeForObservability({ count: 42n, callback: () => undefined })).toEqual({
      value: { count: "42n", callback: "[function]" },
      state: "truncated",
    });
  });

  it("captures and sanitizes the request prompt and selection context", () => {
    executionObservability.startRun("ide-run", "inline_chat", {
      sessionId: "session-1",
      message: "Please refactor this function to improve performance",
      model: "claude-3-5-sonnet",
      workspaceRoot: "/workspace",
      customProvider: { id: "anthropic" },
      history: [],
      context: {
        filePath: "/workspace/src/math.ts",
        language: "typescript",
        fileContent: "export function add(a: number, b: number) { return a + b; }",
        selection: {
          text: "return a + b;",
          startLine: 1,
          startColumn: 44,
          endLine: 1,
          endColumn: 57,
        },
      },
    });

    executionObservability.ingest("ide-run", envelope({
      ToolCallRequested: { call: { id: "call-1", name: "workspace.read", arguments: { path: "src/math.ts" } } },
    }, 1));

    const [record] = executionObservability.getSnapshot().records;
    expect(record.context.requestPrompt).toBe("Please refactor this function to improve performance");
    expect(record.context.selection).toEqual({
      filePath: "/workspace/src/math.ts",
      lineRange: "L1-L1",
      textPreview: "return a + b;",
    });
  });

  it("captures token usage from UsageUpdated envelope and attaches it to tool records", () => {
    executionObservability.startRun("ide-run", "agent_chat", INPUT);
    executionObservability.ingest("ide-run", envelope({
      ToolCallRequested: { call: { id: "call-1", name: "bash.exec", arguments: { command: "cargo check" } } },
    }, 1));

    // Initially tokens are undefined
    expect(executionObservability.getSnapshot().records[0].tokens).toBeUndefined();

    // Ingest UsageUpdated event
    executionObservability.ingest("ide-run", envelope({
      UsageUpdated: {
        usage: {
          agent_id: "agent-1",
          timestamp: new Date().toISOString(),
          metrics: {
            total_tokens: 1450,
            input_tokens: 1200,
            output_tokens: 250,
            cache_read_tokens: 400,
          },
        } as never,
      },
    }, 2));

    const recordWithTokens = executionObservability.getSnapshot().records[0];
    expect(recordWithTokens.tokens).toEqual({
      totalTokens: 1450,
      inputTokens: 1200,
      outputTokens: 250,
      cacheReadTokens: 400,
      cacheWriteTokens: undefined,
      reasoningTokens: undefined,
    });

    // Subsequent tool call in the same run inherits current tokens
    executionObservability.ingest("ide-run", envelope({
      ToolCallRequested: { call: { id: "call-2", name: "workspace.write", arguments: { path: "res.txt" } } },
    }, 3));

    const secondRecord = executionObservability.getSnapshot().records.find((r) => r.callId === "call-2");
    expect(secondRecord?.tokens?.totalTokens).toBe(1450);

    // Direct usage update via recordUsage method
    executionObservability.recordUsage("ide-run", {
      totalTokens: 1800,
      input: 1400,
      output: 400,
    });

    const updatedRecord = executionObservability.getSnapshot().records.find((r) => r.callId === "call-2");
    expect(updatedRecord?.tokens?.totalTokens).toBe(1800);
    expect(updatedRecord?.tokens?.inputTokens).toBe(1400);

    // finishRun preserves tokens
    executionObservability.finishRun("ide-run", { status: "completed", result: { response: "ok", modifiedFiles: [], subagents: [] } });
    const finishedRecord = executionObservability.getSnapshot().records.find((r) => r.callId === "call-2");
    expect(finishedRecord?.status).toBe("failed");
    expect(finishedRecord?.resultPreview).toContain("tool success is unknown");
    expect(finishedRecord?.tokens?.totalTokens).toBe(1800);
  });
});
