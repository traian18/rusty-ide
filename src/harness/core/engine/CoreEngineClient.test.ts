import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { CoreEngineClient } from "./CoreEngineClient";
import type { SessionRecipe } from "../SessionRecipe";

vi.mock("@tauri-apps/api/core", () => {
  class FakeChannel<T> {
    onmessage: (event: T) => void = () => {};
    constructor(onmessage?: (event: T) => void) {
      if (onmessage) this.onmessage = onmessage;
    }
  }
  return { invoke: vi.fn(), Channel: FakeChannel };
});

const invokeMock = vi.mocked(invoke);

const recipe: SessionRecipe = {
  workspace: { root: "/tmp/workspace", binding: "host" },
  integration: "anthropic",
  integration_config: { api_key: "sk-test", base_url: "https://api.anthropic.com", default_model: "claude-opus" },
};

describe("CoreEngineClient", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("hello() invokes harness_hello with no arguments", async () => {
    invokeMock.mockResolvedValue({ protocol_version: 2, capabilities: ["pause_resume"] });
    const client = new CoreEngineClient();

    const result = await client.hello();

    expect(invokeMock).toHaveBeenCalledWith("harness_hello");
    expect(result).toEqual({ protocol_version: 2, capabilities: ["pause_resume"] });
  });

  it("createSession() passes the recipe straight through as harness_create_session's payload", async () => {
    invokeMock.mockResolvedValue("session-1");
    const client = new CoreEngineClient();

    const sessionId = await client.createSession(recipe);

    expect(invokeMock).toHaveBeenCalledWith("harness_create_session", { recipe });
    expect(sessionId).toBe("session-1");
  });

  it("requires policy support before submitting skill permissions", async () => {
    const restricted: SessionRecipe = { ...recipe, execution_policy: { mode: "plan", enabled_tools: ["write_file"], allowed_mcp_servers: [] } };
    invokeMock.mockResolvedValueOnce({ protocol_version: 2, capabilities: [] });
    await expect(new CoreEngineClient().createSession(restricted)).rejects.toThrow(/cannot enforce skill permissions/);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    invokeMock.mockResolvedValueOnce({ protocol_version: 2, capabilities: ["execution_policy"] }).mockResolvedValueOnce("session-policy");
    await expect(new CoreEngineClient().createSession(restricted)).resolves.toBe("session-policy");
    expect(invokeMock).toHaveBeenLastCalledWith("harness_create_session", { recipe: restricted });
  });

  it("subscribe() forwards each delivered BridgeEvent to onEvent, in order", async () => {
    invokeMock.mockResolvedValue(undefined);
    const client = new CoreEngineClient();
    const received: unknown[] = [];

    await client.subscribe("session-1", (event) => received.push(event));

    expect(invokeMock).toHaveBeenCalledWith(
      "harness_subscribe",
      expect.objectContaining({ sessionId: "session-1", onEvent: expect.anything() }),
    );
    const channel = invokeMock.mock.calls[0][1] as { onEvent: { onmessage: (e: unknown) => void } };

    channel.onEvent.onmessage({ kind: "closed", data: { reason: "session closed" } });

    expect(received).toEqual([{ kind: "closed", data: { reason: "session closed" } }]);
  });

  it("mutate() sends the session id and command", async () => {
    invokeMock.mockResolvedValue(undefined);
    const client = new CoreEngineClient();

    await client.mutate("session-1", { type: "prompt", payload: { text: "hi", attachments: [] } });

    expect(invokeMock).toHaveBeenCalledWith("harness_mutate", {
      sessionId: "session-1",
      command: { type: "prompt", payload: { text: "hi", attachments: [] } },
    });
  });

  it("hostToolResult() sends output on success", async () => {
    invokeMock.mockResolvedValue(undefined);
    const client = new CoreEngineClient();

    await client.hostToolResult("session-1", "call-1", { ok: true, output: { content: "file contents" } });

    expect(invokeMock).toHaveBeenCalledWith("harness_host_tool_result", {
      sessionId: "session-1",
      callId: "call-1",
      ok: true,
      output: { content: "file contents" },
    });
  });

  it("hostToolResult() sends the error as output on failure", async () => {
    invokeMock.mockResolvedValue(undefined);
    const client = new CoreEngineClient();

    await client.hostToolResult("session-1", "call-1", { ok: false, error: "not found" });

    expect(invokeMock).toHaveBeenCalledWith("harness_host_tool_result", {
      sessionId: "session-1",
      callId: "call-1",
      ok: false,
      output: "not found",
    });
  });

  it("snapshot() returns the session snapshot", async () => {
    invokeMock.mockResolvedValue({ session_id: "session-1", status: "Idle" });
    const client = new CoreEngineClient();

    const snapshot = await client.snapshot("session-1");

    expect(invokeMock).toHaveBeenCalledWith("harness_snapshot", { sessionId: "session-1" });
    expect(snapshot).toEqual({ session_id: "session-1", status: "Idle" });
  });

  it("closeSession() sends the session id", async () => {
    invokeMock.mockResolvedValue(undefined);
    const client = new CoreEngineClient();

    await client.closeSession("session-1");

    expect(invokeMock).toHaveBeenCalledWith("harness_close_session", { sessionId: "session-1" });
  });

  it("listModels() sends provider and refresh", async () => {
    invokeMock.mockResolvedValue([]);
    const client = new CoreEngineClient();

    await client.listModels("anthropic", true);

    expect(invokeMock).toHaveBeenCalledWith("harness_list_models", { provider: "anthropic", refresh: true });
  });
});
