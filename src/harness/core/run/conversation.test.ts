import { afterEach, describe, expect, it } from "vitest";
import type { AgentEvent, AgentEventEnvelope, MutationCommand } from "@rusty/harness-sdk";
import type { HarnessControlPlane } from "../../contract/controlPlane";
import { createRecordingHost } from "../../testing/recordingHost";
import { CoreHarness, type CoreCapabilityDefinition, type ExecutionAnswerer } from "../CoreHarness";
import type { BridgeEvent, CoreEngine } from "../engine/CoreEngineClient";
import type { SessionRecipe } from "../SessionRecipe";
import { Conversation, releaseConversation } from "./conversation";

class FakeEngine implements CoreEngine {
  recipes: SessionRecipe[] = [];
  prompts: Array<{ sessionId: string; text: string }> = [];
  closed: string[] = [];
  subscriptions: string[] = [];
  private subscribers = new Map<string, (event: BridgeEvent) => void>();
  private next = 1;

  createSession(recipe: SessionRecipe) { this.recipes.push(recipe); return Promise.resolve(`s${this.next++}`); }
  subscribe(id: string, onEvent: (event: BridgeEvent) => void) { this.subscriptions.push(id); this.subscribers.set(id, onEvent); return Promise.resolve(); }
  mutate(sessionId: string, command: MutationCommand) {
    if (command.type === "prompt") this.prompts.push({ sessionId, text: (command.payload as { text: string }).text });
    return Promise.resolve();
  }
  hostToolResult() { return Promise.resolve(); }
  hostExecuteEvent() { return Promise.resolve(); }
  hostExecuteResult() { return Promise.resolve(); }
  closeSession(id: string) { this.closed.push(id); return Promise.resolve(); }
  emit(id: string, event: AgentEvent) {
    this.subscribers.get(id)?.({ kind: "event", data: envelope(id, event) });
  }
  closedByCore(id: string) { this.subscribers.get(id)?.({ kind: "closed", data: { reason: "gone" } } as BridgeEvent); }
}

let eventId = 0;
function envelope(sessionId: string, event: AgentEvent): AgentEventEnvelope {
  eventId += 1;
  return {
    event_id: `e${eventId}`, session_id: sessionId, agent_id: "a", parent_agent_id: null, run_id: `r${eventId}`,
    agent_sequence: eventId, session_sequence: eventId, timestamp: "", visibility: "User", event,
  };
}

const chatDefinition: CoreCapabilityDefinition<"agent_chat"> = {
  capability: "agent_chat",
  recipe: (input) => ({ workspace: { root: "/ws", binding: "host" }, integration: "host", execution_params: { model: input.model }, system_prompt: "You help." } as SessionRecipe),
  promptText: (input) => `FULL HISTORY + ${input.message}`,
  toResult: (transcript) => ({ response: transcript.lastMessageText() }) as never,
  usageContext: (input) => ({ workspaceRoot: "/ws", model: input.model }),
};

type Entry = { id: string; role: "user" | "assistant"; content: string };

function chat(tabId = "chat-1") {
  const engine = new FakeEngine();
  const harness = new CoreHarness({
    engine,
    controlPlane: { recordUsage: async () => {} } as unknown as HarnessControlPlane,
    executionAnswerer: {} as ExecutionAnswerer,
    definitions: { agent_chat: chatDefinition },
  });
  const history: Entry[] = [];
  let n = 0;
  /** Sends `message` as the chat would and lets the run finish (or fail) with an answer. */
  const send = async (message: string, options: { model?: string; ends?: "Success" | "Failed" | "Cancelled" } = {}) => {
    const { host } = createRecordingHost();
    const input = { tabId, message, model: options.model ?? "m1", workspaceRoot: "/ws", chatHistory: [...history], customProvider: {} };
    history.push({ id: `u${++n}`, role: "user", content: message });
    const handle = harness.run("agent_chat", input as never, host, () => {});
    await handle.started;
    const sessionId = engine.prompts.at(-1)!.sessionId;
    engine.emit(sessionId, { AssistantTextDelta: { message_id: `m${n}`, delta: `answer ${n}` } } as AgentEvent);
    engine.emit(sessionId, { Completed: { outcome: options.ends ?? "Success" } } as AgentEvent);
    const outcome = await handle.done;
    if (outcome.status === "completed") history.push({ id: `a${n}`, role: "assistant", content: `answer ${n}` });
    return { sessionId, outcome };
  };
  return { engine, harness, history, send };
}

afterEach(() => releaseConversation("chat-1"));

describe("a chat keeps its session between messages", () => {
  it("continues the same session, sending only the new message", async () => {
    const { engine, send } = chat();
    const first = await send("Read the config");
    const second = await send("Now change it");
    const third = await send("And test it");
    expect(engine.recipes).toHaveLength(1);
    expect(engine.subscriptions).toEqual(["s1"]);
    expect([first.sessionId, second.sessionId, third.sessionId]).toEqual(["s1", "s1", "s1"]);
    expect(engine.prompts.map((prompt) => prompt.text)).toEqual(["FULL HISTORY + Read the config", "Now change it", "And test it"]);
    expect(engine.closed).toEqual([]);
  });

  it("starts a fresh session from the full history when the model changes, closing the old one", async () => {
    const { engine, send } = chat();
    await send("one");
    await send("two", { model: "m2" });
    expect(engine.recipes).toHaveLength(2);
    expect(engine.closed).toEqual(["s1"]);
    expect(engine.prompts.at(-1)).toEqual({ sessionId: "s2", text: "FULL HISTORY + two" });
  });

  it("gives the session up after a failed or cancelled run", async () => {
    const { engine, send } = chat();
    await send("one");
    await send("two", { ends: "Failed" });
    expect(engine.closed).toEqual(["s1"]);
    await send("three");
    expect(engine.prompts.at(-1)).toEqual({ sessionId: "s2", text: "FULL HISTORY + three" });
  });

  it("starts fresh when the chat holds something the session did not see", async () => {
    const { engine, history, send } = chat();
    await send("one");
    // A workflow run (or anything outside this session) added to the chat in between.
    history.push({ id: "w1", role: "user", content: "run the workflow" }, { id: "w2", role: "assistant", content: "workflow result" });
    await send("two");
    expect(engine.recipes).toHaveLength(2);
    expect(engine.prompts.at(-1)!.text).toBe("FULL HISTORY + two");
  });

  it("closes the kept session when the chat is released", async () => {
    const { engine, harness, send } = chat();
    await send("one");
    await harness.releaseSession("chat-1");
    expect(engine.closed).toEqual(["s1"]);
    await send("two");
    expect(engine.prompts.at(-1)).toEqual({ sessionId: "s2", text: "FULL HISTORY + two" });
  });

  it("gives the session up when core closes it", async () => {
    const { engine, send } = chat();
    await send("one");
    engine.closedByCore("s1");
    await send("two");
    expect(engine.recipes).toHaveLength(2);
  });

  it("keeps chats apart", async () => {
    const a = chat("chat-1");
    const b = chat("chat-2");
    await a.send("one");
    await b.send("one");
    await a.send("two");
    expect(a.engine.prompts.at(-1)).toEqual({ sessionId: "s1", text: "two" });
    expect(b.engine.recipes).toHaveLength(1);
    releaseConversation("chat-2");
    expect(b.engine.closed).toEqual(["s1"]);
    expect(a.engine.closed).toEqual([]);
  });
});

describe("Conversation", () => {
  const entries = (...spec: string[]) => spec.map((id) => ({ id, role: id.startsWith("u") ? "user" : "assistant" }));
  const kept = async () => {
    const conversation = new Conversation("c");
    const engine = new FakeEngine();
    await conversation.adopt(engine, "s1", "key", () => {});
    conversation.ended("s1", true, entries("u1", "a1"));
    return { conversation, engine };
  };

  it("continues only with the same key and exactly one more exchange", async () => {
    const { conversation } = await kept();
    expect(conversation.continuable("key", entries("u1", "a1", "u2", "a2"))).toBe("s1");
    expect(conversation.continuable("key", entries("u1", "a1", "u2", "a2", "a3"))).toBe("s1");
    expect(conversation.continuable("other", entries("u1", "a1", "u2", "a2"))).toBeUndefined();
    expect(conversation.continuable("key", entries("u1", "a1", "u2"))).toBeUndefined();
    expect(conversation.continuable("key", entries("u9", "a1", "u2", "a2"))).toBeUndefined();
    expect(conversation.continuable("key", entries("u1", "a1", "u2", "a2", "u3", "a3"))).toBeUndefined();
  });

  it("is busy while a run uses the session, and is not continued then", async () => {
    const { conversation } = await kept();
    conversation.listen(() => {});
    expect(conversation.busy()).toBe(true);
    expect(conversation.continuable("key", entries("u1", "a1", "u2", "a2"))).toBeUndefined();
  });
});
