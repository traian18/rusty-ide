import { createPortal } from "react-dom";
import { GitBranch, ChevronRight, Check, Play, CornerDownLeft, Trash2, X, Plus } from "lucide-react";
import { useGitBranchManager, type GitBranchManagerProps } from "./useGitBranchManager";

export const GitBranchManager: React.FC<GitBranchManagerProps> = (props) => {
  const { currentBranch, disableBranchOnlyActions, branchOnlyActionsReason, localBranches, remoteBranches, onCheckout, onClose } = props;
  const {
    selectedBranch,
    setSelectedBranch,
    menuPosition,
    showCreateInput,
    setShowCreateInput,
    newBranchName,
    setNewBranchName,
    deletingBranch,
    popoverRef,
    ConfirmModalComponent,
    handleCreateSubmit,
    handleMouseEnter,
    handleMouseLeave,
    handleSubMenuMouseEnter,
    handleSubMenuMouseLeave,
    handleMerge,
    handleRebase,
    handleDelete,
  } = useGitBranchManager(props);
  const renderActionsPortal = () => {
    if (!selectedBranch) return null;
    const branch = selectedBranch;
    const isCurrent = branch === currentBranch;
    
    return createPortal(
      <div
        style={{
          position: "fixed",
          top: `${menuPosition.top}px`,
          left: `${menuPosition.left}px`,
        }}
        onMouseEnter={handleSubMenuMouseEnter}
        onMouseLeave={handleSubMenuMouseLeave}
        className="z-[150] w-52 bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-lg shadow-2xl p-1 select-none animate-fadeIn branch-actions-portal"
      >
        <div className="px-3 py-1 border-b border-[var(--border-color)]/30 text-[9px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
          Branch Actions: {branch.split("/").pop()}
        </div>
        {!isCurrent && (
          <button
            onClick={() => { onCheckout(branch); setSelectedBranch(null); }}
            className="w-full text-left px-2.5 py-1.5 hover:bg-[var(--accent-bg)] text-xs font-sans text-[var(--text-normal)] hover:text-[var(--text-light)] rounded transition-colors flex items-center space-x-2 cursor-pointer border-none bg-transparent outline-none"
          >
            <Check size={12} className="text-[var(--color-status-success)]" />
            <span>Checkout</span>
          </button>
        )}
        {!isCurrent && !disableBranchOnlyActions && (
          <button
            onClick={() => { handleMerge(branch); setSelectedBranch(null); }}
            className="w-full text-left px-2.5 py-1.5 hover:bg-[var(--accent-bg)] text-xs font-sans text-[var(--text-normal)] hover:text-[var(--text-light)] rounded transition-colors flex items-center space-x-2 cursor-pointer border-none bg-transparent outline-none"
          >
            <CornerDownLeft size={12} className="text-[var(--color-secondary)]" />
            <span>Merge into Current</span>
          </button>
        )}
        {!isCurrent && !disableBranchOnlyActions && (
          <button
            onClick={() => { handleRebase(branch); setSelectedBranch(null); }}
            className="w-full text-left px-2.5 py-1.5 hover:bg-[var(--accent-bg)] text-xs font-sans text-[var(--text-normal)] hover:text-[var(--text-light)] rounded transition-colors flex items-center space-x-2 cursor-pointer border-none bg-transparent outline-none"
          >
            <Play size={12} className="text-[var(--color-status-warning)]" />
            <span>Rebase Current onto Selected</span>
          </button>
        )}
        {!isCurrent && disableBranchOnlyActions && (
          <div className="px-3 py-2 text-[9px] font-mono text-[var(--text-muted)] italic leading-relaxed">
            Merge/Rebase unavailable: {branchOnlyActionsReason}
          </div>
        )}
        {!isCurrent && (
          <button
            onClick={() => { void handleDelete(branch); }}
            disabled={deletingBranch !== null}
            className="w-full text-left px-2.5 py-1.5 hover:bg-[var(--color-status-danger-bg)] hover:text-[var(--color-status-danger)] text-xs font-sans text-[var(--color-status-danger)] rounded transition-colors flex items-center space-x-2 cursor-pointer border-none bg-transparent outline-none"
          >
            <Trash2 size={12} />
            <span>{deletingBranch === branch ? "Deleting…" : "Delete Branch"}</span>
          </button>
        )}
        {isCurrent && (
          <div className="px-3 py-2 text-[10px] font-mono text-[var(--text-muted)] italic">
            This is your active branch.
          </div>
        )}
      </div>,
      document.body
    );
  };

  return (
    <div
      ref={popoverRef}
      className="absolute right-0 top-12 z-[100] w-64 bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl shadow-2xl p-2 flex flex-col font-sans select-none"
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-[var(--border-color)] mb-2">
        <span className="text-[10px] uppercase font-mono font-bold text-[var(--text-light)] tracking-wider">
          Git Branches
        </span>
        <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-light)] p-0.5 rounded transition-colors border-none bg-transparent cursor-pointer">
          <X size={14} />
        </button>
      </div>

      {/* New Branch Trigger */}
      {showCreateInput ? (
        <form onSubmit={handleCreateSubmit} className="flex items-center space-x-2 mb-2 p-1.5 bg-[var(--color-surface-sunken)] rounded-lg">
          <input
            type="text"
            placeholder="New branch name..."
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            className="flex-1 bg-[var(--bg-app)] border border-[var(--border-color)] rounded px-2 py-1 text-xs text-[var(--text-light)] focus:outline-none focus:border-[var(--accent-color)] font-mono"
            autoFocus
          />
          <button type="submit" className="text-[var(--color-status-success)] hover:text-[var(--color-status-success)] p-1 border-none bg-transparent cursor-pointer">
            <Check size={14} />
          </button>
          <button type="button" onClick={() => setShowCreateInput(false)} className="text-[var(--color-status-danger)] hover:text-[var(--color-status-danger)] p-1 border-none bg-transparent cursor-pointer">
            <X size={14} />
          </button>
        </form>
      ) : (
        <button
          onClick={() => setShowCreateInput(true)}
          className="w-full mb-2 bg-[var(--accent-bg)]/20 border border-[var(--accent-color)]/25 text-[var(--accent-color)] text-xs font-mono font-semibold py-1.5 rounded-lg flex items-center justify-center space-x-1.5 hover:bg-[var(--accent-bg)]/40 transition-all cursor-pointer border-none"
        >
          <Plus size={12} />
          <span>New Branch</span>
        </button>
      )}

      {/* Local & Remote Branches List */}
      <div className="flex-1 overflow-y-auto max-h-56 space-y-1 pr-1">
        <div className="text-[9px] font-mono text-[var(--text-muted)] uppercase tracking-wider mb-1 px-1">
          Local Branches
        </div>
        {localBranches.map((branch) => {
          const isCurrent = branch === currentBranch;
          const isSelected = selectedBranch === branch;
          return (
            <div
              key={branch}
              className="relative"
              onMouseEnter={(e) => handleMouseEnter(e, branch)}
              onMouseLeave={handleMouseLeave}
            >
              <button
                className={`w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors flex items-center justify-between cursor-pointer border-none bg-transparent outline-none ${
                  isCurrent
                    ? "bg-[var(--accent-bg)]/35 text-[var(--accent-color)] font-semibold"
                    : isSelected
                    ? "bg-[var(--color-surface-sunken)] text-[var(--text-light)]"
                    : "text-[var(--text-normal)] hover:bg-[var(--color-surface-sunken)]"
                }`}
              >
                <span className="flex items-center space-x-2 truncate">
                  <GitBranch size={11} className={isCurrent ? "text-[var(--accent-color)]" : "text-[var(--text-muted)]"} />
                  <span className="truncate font-mono text-[11px]">{branch}</span>
                </span>
                <ChevronRight size={11} className="text-[var(--text-muted)] opacity-60" />
              </button>
            </div>
          );
        })}

        {/* Remote Branches Section */}
        <div className="text-[9px] font-mono text-[var(--text-muted)] uppercase tracking-wider mt-3 mb-1 px-1">
          Remote Branches
        </div>
        {remoteBranches.map((branch) => {
          const isSelected = selectedBranch === branch;
          return (
            <div
              key={branch}
              className="relative"
              onMouseEnter={(e) => handleMouseEnter(e, branch)}
              onMouseLeave={handleMouseLeave}
            >
              <button
                className={`w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors flex items-center justify-between cursor-pointer border-none bg-transparent outline-none ${
                  isSelected ? "bg-[var(--color-surface-sunken)] text-[var(--text-light)]" : "text-[var(--text-muted)] hover:bg-[var(--color-surface-sunken)]"
                }`}
              >
                <span className="flex items-center space-x-2 truncate">
                  <GitBranch size={11} className="text-[var(--color-status-info)] opacity-70" />
                  <span className="truncate font-mono text-[11px]">{branch.replace("origin/", "")}</span>
                </span>
                <ChevronRight size={11} className="text-[var(--text-muted)] opacity-60" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Portal Actions Menu Overlay */}
      {renderActionsPortal()}

      {/* Confirmation Dialogs Portal */}
      {ConfirmModalComponent}
    </div>
  );
};
