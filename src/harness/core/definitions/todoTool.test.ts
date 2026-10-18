import { afterEach, describe, expect, it, vi } from "vitest";

import type { HostToolCall } from "../CoreHarness";
import { chatTodoScope, clearTodos, openTodosReminder, stepTodoScope, todosFor, updateTodosTool, type TodoLists } from "./todoTool";

const signal = new AbortController().signal;

describe("update_todos", () => {
  afterEach(() => {
    clearTodos("chat-1");
    clearTodos("chat-2");
  });

  it("saves the list per chat and shows it as progress", async () => {
    const onEvent = vi.fn();
    const result = await updateTodosTool(chatTodoScope("chat-1"), onEvent)({ todos: [
      { content: "Add endpoint", status: "in_progress" },
      { content: "Write tests", status: "pending" },
    ] }, signal);
    expect(result).toEqual({ ok: true, output: "Task list saved: 2 of 2 still open." });
    expect(todosFor("chat-1")).toHaveLength(2);
    expect(todosFor("chat-2")).toEqual([]);
    expect(onEvent).toHaveBeenCalledWith({ kind: "progress", content: "▶ Add endpoint\n☐ Write tests" });
  });

  it("rejects malformed lists and more than one in_progress item", async () => {
    const tool = updateTodosTool(chatTodoScope("chat-1"), () => {});
    expect(await tool({ todos: "x" }, signal)).toMatchObject({ ok: false });
    expect(await tool({ todos: [{ content: "", status: "pending" }] }, signal)).toMatchObject({ ok: false });
    expect(await tool({ todos: [{ content: "a", status: "done" }] }, signal)).toMatchObject({ ok: false });
    expect(await tool({ todos: [{ content: "a", status: "in_progress" }, { content: "b", status: "in_progress" }] }, signal))
      .toEqual({ ok: false, error: "Only one item can be in_progress at a time." });
    expect(todosFor("chat-1")).toEqual([]);
  });

  it("as the completion check, fails while items are open and passes once they are done or cancelled", async () => {
    const tool = updateTodosTool(chatTodoScope("chat-1"), () => {});
    expect(await tool({}, signal)).toEqual({ ok: true, output: "The task list is empty." });
    await tool({ todos: [{ content: "Add endpoint", status: "completed" }, { content: "Write tests", status: "pending" }] }, signal);
    const open = await tool({}, signal);
    expect(open.ok).toBe(false);
    expect(open).toMatchObject({ error: expect.stringContaining("- [pending] Write tests") });
    expect(open).not.toMatchObject({ error: expect.stringContaining("Add endpoint") });
    await tool({ todos: [{ content: "Add endpoint", status: "completed" }, { content: "Write tests", status: "cancelled" }] }, signal);
    expect(await tool(undefined, signal)).toMatchObject({ ok: true });
  });

  it("carries open items into the next message's prompt", async () => {
    expect(openTodosReminder("chat-1")).toBe("");
    await updateTodosTool(chatTodoScope("chat-1"), () => {})({ todos: [{ content: "Write tests", status: "pending" }] }, signal);
    expect(openTodosReminder("chat-1")).toContain("☐ Write tests");
    await updateTodosTool(chatTodoScope("chat-1"), () => {})({ todos: [{ content: "Write tests", status: "completed" }] }, signal);
    expect(openTodosReminder("chat-1")).toBe("");
  });

  it("in a workflow keeps one list per step session, which the gate's check reads", async () => {
    const lists: TodoLists = new Map();
    const tool = updateTodosTool(stepTodoScope(lists, "root"), () => {});
    const call = (sessionId: string) => ({ runId: "run", sessionId, configureExecution: async () => {} }) as HostToolCall;
    await tool({ todos: [{ content: "Task 1", status: "in_progress" }] }, signal, undefined, call("build-1"));
    expect(await tool({}, signal, undefined, call("build-1"))).toMatchObject({ ok: false });
    expect(await tool({}, signal, undefined, call("verify-1"))).toEqual({ ok: true, output: "The task list is empty." });
    expect(todosFor("chat-1")).toEqual([]);
    expect([...lists.keys()]).toEqual(["build-1"]);
  });
});
