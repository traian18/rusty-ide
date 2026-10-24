import React, { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Circle, ListChecks, Loader2, MinusCircle } from "lucide-react";
import type { Todo, TodoStatus } from "../../harness/core/definitions/todoTool";
import { doneCount, type StepPlan } from "./stepPlans";

interface PlanPanelProps {
  plan: Todo[];
  /** A workflow run's plans, one per step session; when there are some they are shown instead of `plan`. */
  steps?: StepPlan[];
}

const STATUS_ICON: Record<TodoStatus, React.ReactNode> = {
  pending: <Circle size={12} className="text-[var(--text-muted)]" />,
  in_progress: <Loader2 size={12} className="text-[var(--accent-color)] animate-spin" />,
  completed: <CheckCircle2 size={12} className="text-[var(--color-status-success)]" />,
  cancelled: <MinusCircle size={12} className="text-[var(--text-muted)]" />,
};

const TodoItems: React.FC<{ todos: Todo[] }> = ({ todos }) => (
  <ol className="py-1 m-0 list-none">
    {todos.map((todo, index) => (
      <li
        key={`${index}:${todo.content}`}
        className={`flex items-start gap-2 px-3 py-1.5 text-[11px] ${
          todo.status === "in_progress" ? "bg-[var(--accent-bg)] text-[var(--text-light)]" : "text-[var(--text-muted)]"
        } ${todo.status === "completed" || todo.status === "cancelled" ? "line-through opacity-70" : ""}`}
      >
        <span className="mt-0.5 flex-shrink-0">{STATUS_ICON[todo.status]}</span>
        <span>{todo.content}</span>
      </li>
    ))}
  </ol>
);

/** An earlier step's plan: one line with its progress, opened on click. */
const EarlierStep: React.FC<{ plan: StepPlan }> = ({ plan }) => {
  const [open, setOpen] = useState(false);
  return (
    <section aria-label={`${plan.label} plan`} className="border-b border-[var(--border-color)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-light)] cursor-pointer border-none bg-transparent text-left"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="flex-1">{plan.label}</span>
        <span className="text-[10px] font-mono">{doneCount(plan.todos)}/{plan.todos.length}</span>
      </button>
      {open ? <TodoItems todos={plan.todos} /> : null}
    </section>
  );
};

/**
 * The model's live task list (`update_todos`), docked on the right of the chat.
 * In a workflow every step keeps its own list: the running step's is open, the
 * earlier ones are folded above it. Expanded it is a card; minimised it is a
 * slim bar on the right edge that expands back to the left when clicked.
 * Renders nothing until a plan exists.
 */
export const PlanPanel: React.FC<PlanPanelProps> = ({ plan, steps = [] }) => {
  const [minimized, setMinimized] = useState(false);
  const current = steps.at(-1);
  const todos = current ? current.todos : plan;
  const hasPlan = todos.length > 0 || steps.length > 1;

  // A fresh plan (after the list was empty) opens the panel again.
  useEffect(() => {
    if (!hasPlan) setMinimized(false);
  }, [hasPlan]);

  if (!hasPlan) return null;

  const done = doneCount(todos);
  const title = current ? `${current.label} plan` : "Plan";

  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        title="Show plan"
        aria-label={`Show ${title.toLowerCase()}, ${done} of ${todos.length} done`}
        className="absolute right-0 top-24 z-20 flex flex-col items-center gap-2 px-1.5 py-3 rounded-l-lg border border-r-0 border-[var(--border-color)] bg-[var(--bg-sidebar)] text-[var(--text-muted)] hover:text-[var(--text-light)] shadow-md cursor-pointer"
      >
        <ChevronLeft size={12} />
        <ListChecks size={12} />
        <span className="text-[10px] font-mono font-bold">{done}/{todos.length}</span>
      </button>
    );
  }

  return (
    <aside
      aria-label="Plan"
      className="absolute right-3 top-24 z-20 w-72 max-h-[60%] flex flex-col rounded-lg border border-[var(--border-color)] bg-[var(--bg-sidebar)] shadow-2xl overflow-hidden"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] flex-shrink-0">
        <div className="flex items-center space-x-2 text-xs font-mono font-bold text-[var(--text-light)]">
          <ListChecks size={12} />
          <span>{title}</span>
          <span className="text-[10px] text-[var(--text-muted)]">{done}/{todos.length}</span>
        </div>
        <button
          type="button"
          onClick={() => setMinimized(true)}
          title="Minimize plan"
          aria-label="Minimize plan"
          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-light)] cursor-pointer border-none bg-transparent"
        >
          <ChevronRight size={12} />
        </button>
      </div>
      <div className="overflow-y-auto">
        {steps.slice(0, -1).map((earlier) => (
          <EarlierStep key={earlier.key} plan={earlier} />
        ))}
        <TodoItems todos={todos} />
      </div>
    </aside>
  );
};
