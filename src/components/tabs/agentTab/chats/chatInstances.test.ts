import { beforeEach, describe, expect, it, vi } from "vitest";

const releaseSession = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../../../harness", () => ({ harness: { run: vi.fn(), releaseSession } }));
const readSavedChat = vi.hoisted(() => vi.fn());
vi.mock("../savedChats", () => ({ readSavedChat }));
vi.mock("../../../../services/workflowCatalogService", () => ({ workflowCatalogService: { workflow: vi.fn(async () => ({ id: "x" })) } }));

import { chatTodoScope, todosFor, updateTodosTool } from "../../../../harness/core/definitions/todoTool";
import { commandPermissionService } from "../../../../services/commandPermissionService";
import { useWorkspaceStore } from "../../../../store";
import { fakeChatTab } from "../../../../test/fakeChatTab";
import { useWorkflowRunStore } from "../../behaviors/workflowRunStore";
import { agentRunHost } from "../runHost";
import { runEventHandler } from "../runEvents";
import { answerWorkflowQuestion, closeChat, loadChat, newChat, stopTurn } from "../tabActions";
import { disposeChat, openChat } from "./chatLifecycle";
import { chatRuntime } from "./chatRuntime";
import { tabChatIds, useChatStore } from "./chatStore";

const progress = () => ({ stepTypes: {}, changed: new Set<string>() });

beforeEach(() => {
  useWorkspaceStore.setState({ agentChats: {} });
  useWorkflowRunStore.setState({ runs: {}, chatRuns: {} });
  releaseSession.mockClear();
});

describe("chat store", () => {
  it("keeps each chat's view apart and shows the neighbour of a closed chat", () => {
    const tab = fakeChatTab("t");
    const second = openChat("t");
    const third = openChat("t");
    expect(tabChatIds("t")).toEqual(["t", second, third]);
    expect(tab.activeChatId()).toBe(third);

    useChatStore.getState().patch("t", { message: "draft one", isStreaming: true });
    useChatStore.getState().patch(second, { message: "draft two" });
    const chats = useChatStore.getState().chats;
    expect([chats.t.message, chats[second].message, chats[third].message]).toEqual(["draft one", "draft two", ""]);
    expect(chats[second].isStreaming).toBe(false);

    useChatStore.getState().select("t", second);
    disposeChat(second);
    expect(tabChatIds("t")).toEqual(["t", third]);
    expect(tab.activeChatId()).toBe(third);
    // A patch to a closed chat does nothing.
    useChatStore.getState().patch(second, { message: "late" });
    expect(useChatStore.getState().chats[second]).toBeUndefined();
  });

  it("New chat replaces a blank chat with a fresh one in its place, and opens another beside one with a conversation", () => {
    const tab = fakeChatTab("t");
    const first = openChat("t");
    useChatStore.getState().select("t", "t");
    useChatStore.getState().patch("t", { chatWorkflow: "flow", message: "draft" });
    const replaced = newChat(tab.chats.context());
    expect(replaced).not.toBe("t");
    // Same place in the strip, the draft kept, nothing else.
    expect(tabChatIds("t")).toEqual([replaced, first]);
    expect(useChatStore.getState().chats[replaced]).toMatchObject({ message: "draft", chatWorkflow: undefined });
    expect(useChatStore.getState().chats.t).toBeUndefined();

    useWorkspaceStore.getState().addAgentMessage(replaced, { id: "m", role: "user", content: "hi", timestamp: "t" });
    const opened = newChat(tab.chats.context());
    expect(opened).not.toBe(replaced);
    expect(tabChatIds("t")).toEqual([replaced, first, opened]);
    expect(useWorkspaceStore.getState().agentChats[replaced]).toHaveLength(1);
    expect(useWorkspaceStore.getState().agentChats[opened]).toEqual([]);
  });

  it("never hands one conversation's waiting run, goal or queue to another", async () => {
    // The 2026-10-28 spillover: a Specs page run waited in a blank chat, a saved chat was loaded
    // into it, and the next question there ran the spec's workflow.
    const tab = fakeChatTab("t");
    const pending = tab.chats.turnFor("t");
    pending.state.specRun = { root: "/ws", change: "0001-x", step: "plan", workflowPath: "builtin:spec-plan" };
    pending.state.specQueue = [{ message: "next", run: { root: "/ws", change: "0001-x", step: "capability" } }] as never;
    pending.state.goal = { id: "g-1", pass: 1, checks: [] };
    tab.chats.sessionFor("t").setChatWorkflow("builtin:spec-plan", { persist: false });

    readSavedChat.mockResolvedValue({ messages: [{ id: "q", role: "user", content: "Rust guide", timestamp: "t" }] });
    await loadChat(tab.chats.context(), { path: "/ws/.rusty/chats/rust.json" } as never);
    const loaded = tab.activeChatId();
    expect(loaded).not.toBe("t");
    const { state, view } = tab.active();
    expect([state.specRun, state.specQueue, state.goal]).toEqual([undefined, [], undefined]);
    expect(view.chatWorkflow).toBeUndefined();
    expect(useWorkspaceStore.getState().agentChats[loaded]).toHaveLength(1);
    // The prepared chat is a conversation of its own: it stays, with its run still waiting.
    expect(tabChatIds("t")).toEqual(["t", loaded]);
    expect(chatRuntime("t").state.specRun?.change).toBe("0001-x");
  });

  it("puts a loaded chat in place of a blank one, which takes nothing with it", async () => {
    const tab = fakeChatTab("t");
    useChatStore.getState().patch("t", { chatWorkflow: "flow" });
    readSavedChat.mockResolvedValue({ messages: [{ id: "q", role: "user", content: "hello", timestamp: "t" }] });
    await loadChat(tab.chats.context(), { path: "/ws/.rusty/chats/hello.json" } as never);
    const loaded = tab.activeChatId();
    expect(tabChatIds("t")).toEqual([loaded]);
    expect(loaded).not.toBe("t");
    expect(tab.active().view.chatWorkflow).toBeUndefined();
  });
});

describe("concurrent chats", () => {
  it("routes each run's events, plan, usage and approvals to the chat that started it", async () => {
    const tab = fakeChatTab("t");
    const other = openChat("t");
    const first = tab.chats.turnFor("t");
    const second = tab.chats.turnFor(other);
    first.activity.writeTo("console-1");
    useWorkspaceStore.getState().addAgentMessage("t", { id: "console-1", role: "console", content: "", timestamp: "t" });

    runEventHandler(first, progress())({ kind: "plan", todos: [{ content: "first plan", status: "in_progress" }] } as never);
    runEventHandler(second, progress())({ kind: "usage", usage: { total_tokens: 7 } } as never);
    runEventHandler(first, progress())({ kind: "progress", content: "first progress" } as never);
    const chats = useChatStore.getState().chats;
    expect(chats.t.plan.map((todo) => todo.content)).toEqual(["first plan"]);
    expect(chats[other].plan).toEqual([]);
    expect(chats[other].runUsage).toEqual({ total_tokens: 7 });
    expect(chats.t.runUsage).toBeNull();
    expect(useWorkspaceStore.getState().agentChats.t.find((m) => m.id === "console-1")?.content).toContain("first progress");
    expect(useWorkspaceStore.getState().agentChats[other]).toEqual([]);

    // A step of the second chat's workflow asks for approval: only that chat waits, and only it answers.
    const controller = new AbortController();
    const approval = agentRunHost(second).askWorkflowInput!({ requestId: "w1", step: "Review", prompt: "Approve?" } as never, controller.signal);
    expect(useChatStore.getState().chats[other].workflowQuestions.map((q) => q.requestId)).toEqual(["w1"]);
    expect(useChatStore.getState().chats.t.workflowQuestions).toEqual([]);
    answerWorkflowQuestion(second, useChatStore.getState().chats[other].workflowQuestions, { decision: "approve" } as never);
    await expect(approval).resolves.toEqual({ decision: "approve" });
    expect(useChatStore.getState().chats[other].workflowQuestions).toEqual([]);
  });

  it("keeps each chat's own workflow run, while the canvas sees the latest", () => {
    const store = useWorkflowRunStore.getState();
    store.begin("build", "a");
    store.begin("build", "b");
    store.step("build", { nodeId: "plan", status: "running", attempt: 1 }, "a");
    store.finish("build", "completed", undefined, "b");
    const { chatRuns, runs } = useWorkflowRunStore.getState();
    expect(chatRuns.a).toMatchObject({ workflowId: "build", status: "running", current: "plan" });
    expect(chatRuns.b).toMatchObject({ workflowId: "build", status: "completed" });
    expect(chatRuns.b.steps).toEqual({});
    expect(runs.build.status).toBe("completed");
    store.forgetChat("a");
    expect(useWorkflowRunStore.getState().chatRuns.a).toBeUndefined();
  });

  it("stops one chat without touching another, and a closed chat releases its session, grants and todos", async () => {
    const tab = fakeChatTab("t");
    const other = openChat("t");
    const cancels = { t: vi.fn(), [other]: vi.fn() };
    for (const chatId of ["t", other]) {
      chatRuntime(chatId).state.agentRun = { runId: chatId, cancel: cancels[chatId] } as never;
      chatRuntime(chatId).state.isStreaming = true;
      useChatStore.getState().patch(chatId, { isStreaming: true });
    }
    await updateTodosTool(chatTodoScope(other), () => {})({ todos: [{ content: "other's todo", status: "pending" }] } as never, new AbortController().signal);
    expect(todosFor(other)).toHaveLength(1);
    expect(todosFor("t")).toEqual([]);

    stopTurn(tab.chats.turnFor("t"));
    expect(cancels.t).toHaveBeenCalled();
    expect(cancels[other]).not.toHaveBeenCalled();
    expect(useChatStore.getState().chats[other].isStreaming).toBe(true);

    const clearSession = vi.spyOn(commandPermissionService, "clearSession");
    closeChat(tab.chats.context(), other);
    expect(cancels[other]).toHaveBeenCalled();
    expect(clearSession).toHaveBeenCalledWith(other);
    expect(clearSession).not.toHaveBeenCalledWith("t");
    expect(releaseSession).toHaveBeenCalledWith(other);
    expect(todosFor(other)).toEqual([]);
    expect(tabChatIds("t")).toEqual(["t"]);
  });

  it("re-renders nothing for a token that leaves the chat as it was, and records a sign of life at most once a second", () => {
    const tab = fakeChatTab("t");
    const other = openChat("t");
    const turn = tab.chats.turnFor(other);
    const handle = runEventHandler(turn, progress());
    useWorkflowRunStore.getState().begin("build", other);
    const chatUpdates = vi.fn();
    const runUpdates = vi.fn();
    const stopChats = useChatStore.subscribe(chatUpdates);
    const stopRuns = useWorkflowRunStore.subscribe(runUpdates);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 5000);
      for (let i = 0; i < 50; i++) handle({ kind: "token", content: "x", messageId: "m" } as never);
      // The first token sets the status line and records activity; the other 49 change nothing.
      expect(chatUpdates).toHaveBeenCalledTimes(1);
      expect(runUpdates).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1000);
      handle({ kind: "token", content: "x", messageId: "m" } as never);
      expect(runUpdates).toHaveBeenCalledTimes(2);
      expect(chatUpdates).toHaveBeenCalledTimes(1);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
      stopChats();
      stopRuns();
    }
  });

  it("drops what a closed chat's run still sends, even when its id is reused", () => {
    const tab = fakeChatTab("t");
    const stale = tab.chats.turnFor("t");
    disposeChat("t");
    openChat("t");
    stale.addMessage({ id: "late", role: "assistant", content: "late", timestamp: "t" });
    stale.ui.setRunUsage({ total_tokens: 3 } as never);
    runEventHandler(stale, progress())({ kind: "plan", todos: [{ content: "late plan", status: "pending" }] } as never);
    expect(useWorkspaceStore.getState().agentChats.t).toEqual([]);
    expect(useChatStore.getState().chats.t.runUsage).toBeNull();
    expect(useChatStore.getState().chats.t.plan).toEqual([]);
  });
});
