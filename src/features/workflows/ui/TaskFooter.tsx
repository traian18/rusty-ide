import React from "react";
import { Octagon, Sparkles } from "lucide-react";

export interface TaskFooterProps {
  nodeStatus: string;
  taskNodeId: string;
  onExecute: (nodeId: string) => void;
  onStop: (nodeId: string) => void;
  hidden: boolean;
}

/** The status line and run or stop button under a task's executor. */
export const TaskFooter: React.FC<TaskFooterProps> = ({ nodeStatus, taskNodeId, onExecute, onStop, hidden }) => {
  if (hidden) return null;
  return (
        <div className="p-3 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]/20 flex items-center justify-between select-none flex-shrink-0">
          <span className="text-[10px] uppercase font-mono text-[var(--text-muted)]">
            Status: <span className="font-bold text-[var(--text-normal)]">{nodeStatus}</span>
          </span>
          {nodeStatus === "running" ? (
            <button
              onClick={() => onStop(taskNodeId)}
              className="bg-[var(--color-status-danger-solid)] hover:bg-[var(--color-status-danger-solid)] text-[var(--color-status-danger-solid-foreground)] text-xs font-mono font-bold px-4 py-2 rounded-lg flex items-center space-x-1.5 transition-all shadow-md cursor-pointer"
            >
              <Octagon size={14} />
              <span>Stop</span>
            </button>
          ) : (
            <button
              onClick={() => onExecute(taskNodeId)}
              className="bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/80 text-[var(--color-primary-foreground)] text-xs font-mono font-bold px-4 py-2 rounded-lg flex items-center space-x-1.5 transition-all glow-btn shadow-md cursor-pointer"
            >
              <Sparkles size={14} />
              <span>Run Executor</span>
            </button>
          )}
        </div>
  );
};
