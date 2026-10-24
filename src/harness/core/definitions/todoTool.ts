// definitions/todoTool.ts — `update_todos`: the single agent's task list.
//
// For the single agent the list belongs to the chat (keyed by `tabId`), not
// to one run, so a request that spans several messages keeps its open items:
// they are put in front of the next message's prompt (`openTodosReminder`).
// In a workflow every agent step runs in its own session, so each step (and
// each retry) keeps its own list for the length of the run.
//
// The same tool is the completion check of the single-agent profile
// (`SINGLE_AGENT_PROFILE`) and of every built-in step profile:
// rusty-core's gate calls it with no `todos`, scoped to the agent's session,
// and it fails while items are still pending or in progress, and in a
// workflow step also while the step has made no plan. A model that
// calls it that way just gets the current list back.

import type { CapabilityEvent } from "../../contract";
import type { HostToolCall, HostToolHandler } from "../CoreHarness";
import type { HostToolSpec } from "../SessionRecipe";

export const UPDATE_TODOS_TOOL_NAME = "update_todos";

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface Todo {
  content: string;
  status: TodoStatus;
}

const STATUSES: readonly TodoStatus[] = ["pending", "in_progress", "completed", "cancelled"];
const MARKS: Record<TodoStatus, string> = { pending: "☐", in_progress: "▶", completed: "☑", cancelled: "✕" };

export const UPDATE_TODOS_TOOL: HostToolSpec = {
  name: UPDATE_TODOS_TOOL_NAME,
  description: "Replace this chat's task list with the complete, updated list. Use it for any request with two or more distinct requirements or steps. Keep exactly one item in_progress while work remains, and mark an item completed only once it is actually done. Your turn cannot end while items are pending or in_progress: finish them, or cancel the ones that are no longer needed.",
  input_schema: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        description: "The whole list, in order. Items left out are removed.",
        items: {
          type: "object",
          properties: {
            content: { type: "string", description: "One specific, checkable requirement or step." },
            status: { type: "string", enum: [...STATUSES] },
          },
          required: ["content", "status"],
        },
      },
    },
    required: ["todos"],
  },
};

export const UPDATE_TODOS_GUIDE = "- 'update_todos': Keep this chat's task list: send the complete list each time, with each item pending, in_progress, completed or cancelled (input: {\"todos\": [{\"content\": \"…\", \"status\": \"in_progress\"}]}).";

/** Lists by key: chat lists live for the app's lifetime, step lists for one run. */
export type TodoLists = Map<string, Todo[]>;

const chatLists: TodoLists = new Map();

export function todosFor(chatId: string): Todo[] {
  return chatLists.get(chatId) ?? [];
}

export function clearTodos(chatId: string): void {
  chatLists.delete(chatId);
}

/** Where a call's list lives: the chat's, or in a workflow the calling step session's. */
export interface TodoScope {
  lists: TodoLists;
  key(call?: HostToolCall): string;
  /** In a workflow: the step the list belongs to, shown with it. */
  step?(call?: HostToolCall): { key: string; name: string } | undefined;
  /** A workflow step must make a plan: the gate's check fails while it has none. */
  requiresPlan?: boolean;
}

export function chatTodoScope(chatId: string): TodoScope {
  return { lists: chatLists, key: () => chatId };
}

/** `lists` is the run's own map, so step lists end with the run. `currentStep` names the running step. */
export function stepTodoScope(lists: TodoLists, rootSessionKey: string, currentStep: () => { id: string; name: string } | undefined = () => undefined): TodoScope {
  const key = (call?: HostToolCall) => call?.sessionId ?? rootSessionKey;
  return {
    lists,
    key,
    requiresPlan: true,
    step: (call) => {
      const step = currentStep();
      return step && { key: `${step.id}:${key(call)}`, name: step.name };
    },
  };
}

function isOpen(todo: Todo): boolean {
  return todo.status === "pending" || todo.status === "in_progress";
}

export function renderTodos(todos: Todo[]): string {
  return todos.map((todo) => `${MARKS[todo.status]} ${todo.content}`).join("\n");
}

function parseTodos(value: unknown): Todo[] | string {
  if (!Array.isArray(value)) return "'todos' must be an array of {content, status} items.";
  const todos: Todo[] = [];
  for (const [index, item] of value.entries()) {
    const content = typeof item?.content === "string" ? item.content.trim() : "";
    const status = item?.status;
    if (!content) return `Item ${index + 1} has no content.`;
    if (!STATUSES.includes(status)) return `Item ${index + 1} has status ${JSON.stringify(status)}; use one of ${STATUSES.join(", ")}.`;
    todos.push({ content, status });
  }
  if (todos.filter((todo) => todo.status === "in_progress").length > 1) {
    return "Only one item can be in_progress at a time.";
  }
  return todos;
}

const AGAIN = "Then give your complete answer again as your last message: only the last message counts as your answer, so do not shorten it to a note that the list is done.";

const NO_PLAN = `You have not written a plan for this step. Call 'update_todos' with your plan for this step (the items of your step instructions, made specific to this task), mark what you have already done as completed, and finish or cancel the rest. ${AGAIN}`;

/** What is still open, for the gate's feedback and the model's own check. */
function openItemsReport(todos: Todo[]): string {
  const open = todos.filter(isOpen);
  return `${open.length} task list item${open.length === 1 ? " is" : "s are"} not done:\n${open.map((todo) => `- [${todo.status}] ${todo.content}`).join("\n")}\n\nKeep working until each one is done and mark it completed with 'update_todos'. If an item is no longer needed, mark it cancelled. If you are blocked on a decision only the user can make, ask with 'ask_user_question'. ${AGAIN}`;
}

export function updateTodosTool(scope: TodoScope, onEvent: (event: CapabilityEvent<"agent_chat">) => void): HostToolHandler {
  return async (args, _signal, _observer, call) => {
    const key = scope.key(call);
    const raw = (args as { todos?: unknown } | undefined)?.todos;
    if (raw === undefined) {
      const todos = scope.lists.get(key) ?? [];
      if (todos.some(isOpen)) return { ok: false, error: openItemsReport(todos) };
      if (!todos.length && scope.requiresPlan) return { ok: false, error: NO_PLAN };
      return { ok: true, output: todos.length ? `All items are done:\n${renderTodos(todos)}` : "The task list is empty." };
    }
    const todos = parseTodos(raw);
    if (typeof todos === "string") return { ok: false, error: todos };
    scope.lists.set(key, todos);
    if (todos.length > 0) onEvent({ kind: "progress", content: renderTodos(todos) });
    const step = scope.step?.(call);
    onEvent(step ? { kind: "plan", todos, step } : { kind: "plan", todos });
    const open = todos.filter(isOpen).length;
    return { ok: true, output: open ? `Task list saved: ${open} of ${todos.length} still open.` : `Task list saved: all ${todos.length} done.` };
  };
}

/** Open items from earlier messages, put in front of the next prompt. */
export function openTodosReminder(chatId: string): string {
  const todos = todosFor(chatId);
  if (!todos.some(isOpen)) return "";
  return `[Task list carried over from earlier in this chat. Finish the open items unless the message below changes what is wanted; then update the list with 'update_todos' (cancel items that no longer apply).]\n${renderTodos(todos)}\n\n`;
}
