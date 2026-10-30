import React from "react";
import { ChevronDown, ArrowUp } from "lucide-react";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface CommitEntry {
  hash: string;
  short_hash: string;
  subject: string;
  author: string;
  date: string;
  is_unpushed?: boolean;
}

interface SourceControlHistoryProps {
  historyCommits: CommitEntry[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onOpenGraph: () => void;
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

/**
 * Collapsible Git history section shown at the bottom of the
 * Source Control panel.
 *
 * Displays the last N commits (latest first) and a link to the
 * full commit graph.
 */
const SourceControlHistory: React.FC<SourceControlHistoryProps> = ({
  historyCommits,
  isExpanded,
  onToggleExpand,
  onOpenGraph,
}) => {
  return (
    <div className="flex-shrink-0 border-t border-[var(--border-color)]/40">
      {/* Header / toggle */}
      <div
        onClick={onToggleExpand}
        className="px-3 py-2 flex items-center justify-between text-[10px] font-mono font-bold text-[var(--text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--text-light)] select-none bg-[var(--color-surface-sunken)]"
      >
        <div className="flex items-center space-x-1.5">
          <ChevronDown
            size={11}
            className={`transform transition-transform duration-200 ${
              isExpanded ? "" : "-rotate-90"
            }`}
          />
          <span>Git History</span>
          <span className="bg-[var(--border-color)] px-1.5 py-0.2 rounded-full text-[9px] text-[var(--text-normal)]">
            {historyCommits.length}
          </span>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenGraph();
          }}
          className="text-[9px] text-[var(--accent-color)] hover:underline cursor-pointer flex items-center space-x-1 font-bold font-mono"
        >
          <span>[ full graph ]</span>
        </button>
      </div>

      {/* Collapsible body */}
      <div
        className={`transition-all duration-200 ease-out ${
          isExpanded ? "max-h-64" : "max-h-0"
        } overflow-hidden`}
      >
        <div className="flex flex-col-reverse p-2 pt-0 space-y-0.5 max-h-60 overflow-y-auto">
          {historyCommits.length === 0 ? (
            <div className="text-center py-4 text-[10px] text-[var(--text-muted)] font-mono">
              No commits yet.
            </div>
          ) : (
            historyCommits.map((commit) => (
              <div
                key={commit.hash}
                onClick={onOpenGraph}
                className="group flex items-center justify-between px-2 py-1 rounded hover:bg-[var(--accent-bg)]/20 cursor-pointer transition-colors"
                title="Click to open Git Graph"
              >
                <div className="flex flex-col min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center space-x-1.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        commit.is_unpushed
                          ? "bg-[var(--color-status-warning-solid)] animate-pulse"
                          : "bg-[var(--accent-color)]"
                      }`}
                    />
                    <span className="text-[var(--text-normal)] group-hover:text-[var(--text-light)] truncate font-mono text-[10.5px]">
                      {commit.subject}
                    </span>
                  </div>
                  <div className="flex items-center text-[9px] text-[var(--text-muted)] font-mono space-x-2 pl-3">
                    <span className="truncate max-w-[80px]">{commit.author}</span>
                    <span>•</span>
                    <span>{commit.date}</span>
                    <span>•</span>
                    <span className="font-bold">{commit.short_hash}</span>
                  </div>
                </div>
                {commit.is_unpushed && (
                  <span title="Outgoing commit">
                    <ArrowUp
                      size={10}
                      className="text-[var(--color-status-warning)] flex-shrink-0 ml-1.5"
                    />
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default SourceControlHistory;
