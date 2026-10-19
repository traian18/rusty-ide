import React, { useEffect, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, ListChecks, Loader2, MinusCircle } from "lucide-react";
import type { Todo, TodoStatus } from "../../harness/core/definitions/todoTool";

interface PlanPanelProps {
  plan: Todo[];
}

const STATUS_ICON: Record<TodoStatus, React.ReactNode> = {
  pending: <Circle size={12} className="text-[var(--text-muted)]" />,
  in_progress: <Loader2 size={12} className="text-[var(--accent-color)] animate-spin" />,
  completed: <CheckCircle2 size={12} className="text-[var(--color-status-success)]" />,
  cancelled: <MinusCircle size={12} className="text-[var(--text-muted)]" />,
};

/**
 * The model's live task list (`update_todos`), docked on the right of the chat.
 * Expanded it is a card; minimised it is a slim bar on the right edge that
 * expands back to the left when clicked. Renders nothing until a plan exists.
 */
export const PlanPanel: React.FC<PlanPanelProps> = ({ plan }) => {
  const [minimized, setMinimized] = useState(false);
  const hasPlan = plan.length > 0;

  // A fresh plan (after the list was empty) opens the panel again.
  useEffect(() => {
    if (!hasPlan) setMinimized(false);
  }, [hasPlan]);

  if (!hasPlan) return null;

  const done = plan.filter((t) => t.status === "completed").length;

  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        title="Show plan"
        aria-label={`Show plan, ${done} of ${plan.length} done`}
        className="absolute right-0 top-24 z-20 flex flex-col items-center gap-2 px-1.5 py-3 rounded-l-lg border border-r-0 border-[var(--border-color)] bg-[var(--bg-sidebar)] text-[var(--text-muted)] hover:text-[var(--text-light)] shadow-md cursor-pointer"
      >
        <ChevronLeft size={12} />
        <ListChecks size={12} />
        <span className="text-[10px] font-mono font-bold">{done}/{plan.length}</span>
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
          <span>Plan</span>
          <span className="text-[10px] text-[var(--text-muted)]">{done}/{plan.length}</span>
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
      <ol className="overflow-y-auto py-1 m-0 list-none">
        {plan.map((todo, index) => (
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
    </aside>
  );
};
