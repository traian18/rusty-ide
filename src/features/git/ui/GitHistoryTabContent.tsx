import { RotateCcw, ArrowUp, ArrowDown, GitCommit } from "lucide-react";
import type { TabOfType } from "../../../app/tabs/types";
import { useGitHistory } from "./useGitHistory";
import { CommitRow } from "./CommitRow";

export const GitHistoryTabContent: React.FC<{ tab: TabOfType<"git-history"> }> = ({ tab }) => {
  const model = useGitHistory(tab);
  const {
    headBadgeLabel,
    commits,
    loading,
    error,
    isPushing,
    isPulling,
    ConfirmModalComponent,
    handleRefresh,
    handlePush,
    handlePull,
    unpushedCommitsCount,
    isFileHistory,
    fileBasename,
  } = model;
  return (
    <div className="w-full h-full flex flex-col bg-[var(--bg-app)] font-sans text-xs select-none text-[var(--text-normal)]">
      {/* Control Header Panel */}
      <div className="px-6 py-4 bg-[var(--bg-sidebar)] border-b border-[var(--border-color)] flex items-center justify-between flex-shrink-0">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <h2 className="text-base font-bold text-[var(--text-light)]">
              {isFileHistory ? `History: ${fileBasename}` : "Git Commit History"}
            </h2>
            <span className="bg-[var(--accent-bg)] text-[var(--accent-color)] text-[10px] px-2 py-0.5 rounded font-mono font-bold border border-[var(--accent-color)]/25">
              {headBadgeLabel}
            </span>
          </div>
          <p className="text-[10px] text-[var(--text-muted)] font-mono truncate max-w-lg">
            {isFileHistory ? `Showing commits affecting ${tab.path}` : "Showing last 100 commits from all branches"}
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-2">
          {!isFileHistory && unpushedCommitsCount > 0 && (
            <div className="flex items-center space-x-1.5 bg-[var(--color-status-warning-bg)] border border-[var(--color-status-warning-border)] text-[var(--color-status-warning)] px-3 py-1.5 rounded-lg text-[10px] font-mono font-semibold mr-2 select-none">
              <ArrowUp size={11} className="animate-bounce" />
              <span>{unpushedCommitsCount} outgoing commit{unpushedCommitsCount > 1 ? "s" : ""}</span>
            </div>
          )}

          {!isFileHistory && (
            <>
              <button
                onClick={handlePull}
                disabled={loading || isPulling || isPushing}
                className="bg-[var(--bg-app)] border border-[var(--border-color)] hover:border-[var(--border-active)] hover:text-[var(--text-light)] text-[var(--text-normal)] disabled:opacity-50 px-3 py-1.5 rounded-lg font-mono font-semibold transition-all flex items-center space-x-1.5 cursor-pointer"
                title="Pull remote commits"
              >
                <ArrowDown size={12} className={isPulling ? "animate-bounce" : ""} />
                <span>Pull</span>
              </button>

              <button
                onClick={handlePush}
                disabled={loading || isPulling || isPushing}
                className="bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/85 text-[var(--color-primary-foreground)] disabled:bg-[var(--border-color)] disabled:opacity-50 px-3.5 py-1.5 rounded-lg font-mono font-bold transition-all shadow-md hover:shadow-indigo-500/10 flex items-center space-x-1.5 cursor-pointer glow-btn"
                title="Push local commits"
              >
                <ArrowUp size={12} className={isPushing ? "animate-bounce" : ""} />
                <span>Push</span>
              </button>
            </>
          )}

          <button
            onClick={handleRefresh}
            disabled={loading}
            className="p-2 bg-[var(--bg-app)] border border-[var(--border-color)] hover:border-[var(--border-active)] hover:text-[var(--text-light)] text-[var(--text-normal)] disabled:opacity-50 rounded-lg transition-all cursor-pointer flex items-center justify-center"
            title="Refresh commits history"
          >
            <RotateCcw size={13} className={loading ? "animate-spin text-[var(--accent-color)]" : ""} />
          </button>
        </div>
      </div>

      {/* Main Commit Graph Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && commits.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full space-y-2 text-[var(--text-muted)] font-mono">
            <RotateCcw size={20} className="animate-spin text-[var(--accent-color)]" />
            <span>Reading Git logs...</span>
          </div>
        ) : error ? (
          <div className="p-8 max-w-lg mx-auto text-center space-y-3 font-mono">
            <span className="text-[var(--color-status-danger)] font-bold block text-sm">Failed to retrieve commit history</span>
            <div className="bg-[var(--color-surface-sunken)] border border-[var(--border-color)] p-4 rounded-lg text-left text-xs break-all text-[var(--text-muted)] select-text">
              {error}
            </div>
            <button
              onClick={handleRefresh}
              className="px-4 py-2 bg-[var(--bg-sidebar)] border border-[var(--border-color)] hover:border-[var(--border-active)] text-xs rounded-lg cursor-pointer font-bold"
            >
              Retry
            </button>
          </div>
        ) : commits.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)] font-mono space-y-2">
            <GitCommit size={24} className="opacity-40" />
            <span className="text-sm font-semibold">No Commits Found</span>
            <span className="text-[10px] max-w-[250px] text-center leading-relaxed">
              This repository does not have any commits yet. Make your first commit from the Source Control panel.
            </span>
          </div>
        ) : (
          <div className="flex flex-col py-4">
            {commits.map((commit, index) => (
              <CommitRow key={commit.hash} commit={commit} index={index} model={model} />
            ))}
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      {ConfirmModalComponent}
    </div>
  );
};
