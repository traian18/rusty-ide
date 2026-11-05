import React from "react";
import { Loader2 } from "lucide-react";
import { gitService } from "./gitService";
import SourceControlHeader from "./sourceControl/SourceControlHeader";
import SourceControlCommitBox from "./sourceControl/SourceControlCommitBox";
import { SourceControlConflictBanner } from "./sourceControl/SourceControlConflictBanner";
import SourceControlChangeList from "./sourceControl/SourceControlChangeList";
import SourceControlHistory from "./sourceControl/SourceControlHistory";
import { GitFileContextMenu } from "./sourceControl/SourceControlContextMenu";
import { NoFolderEmptyState, NoGitRepoEmptyState } from "./sourceControl/SourceControlEmptyState";
import { useSourceControl } from "./useSourceControl";
import { useSourceControlHandlers } from "./useSourceControlHandlers";
import { useBranchHandlers } from "./useBranchHandlers";

/**
 * Sidebar panel that provides full Git source-control
 * functionality: staging, committing, branching, pulling,
 * pushing, diff viewing, and commit history.
 *
 * This component only renders. State lives in `useSourceControl`, and the
 * handlers live in `useSourceControlHandlers`.
 */
const SourceControl: React.FC = () => {
  const model = useSourceControl();
  const handlers = useSourceControlHandlers(model);
  const branchHandlers = useBranchHandlers(model);
  const {
    rootPath,
    repositoriesLoading,
    repositories,
    activeRepository,
    activeRepo,
    subprojects,
    gitStatus,
    headLabel,
    disableBranchOnlyActions,
    branchOnlyActionsReason,
    commitMsg,
    setCommitMsg,
    isCommitting,
    isPushing,
    isPulling,
    initLoading,
    submoduleActionLoading,
    localBranches,
    remoteBranches,
    isHistoryExpanded,
    setIsHistoryExpanded,
    historyCommits,
    showBranchPopover,
    isRepoDataLoading,
    fileContextMenu,
    setFileContextMenu,
    modifiedList,
    untrackedList,
    totalChanges,
    loadRepoData,
    ConfirmModalComponent,
  } = model;
  const {
    handleOpenGraph,
    handleInitializeRepo,
    handleCommit,
    handlePull,
    handlePush,
    handleStageFile,
    handleUnstageFile,
    handleAddToGitignore,
    handleFileContextMenu,
    handleDiscardChanges,
    handleDiscardAllChanges,
    handleOpenFileDiff,
    handleOpenConflicts,
    handleCompletePending,
    handleRepoChange,
    handleSubmoduleAction,
  } = handlers;
  const {
    handleCheckoutBranch,
    handleCreateBranch,
    handleDeleteBranch,
    handleBranchPopoverToggle,
    handleCloseBranchPopover,
    handleMergeBranch,
    handleRebaseBranch,
    handleAbortPending,
    handleUndoRename,
  } = branchHandlers;

  // ── Early Returns (Empty / Non-Repo States) ───────────────

  if (!rootPath) {
    return <NoFolderEmptyState />;
  }

  if (repositoriesLoading && repositories.length === 0) {
    return (
      <div className="p-4 text-xs text-[var(--text-muted)] flex items-center gap-2" role="status" aria-label="Finding repositories">
        <Loader2 size={14} className="animate-spin" aria-hidden="true" />
        <span>Finding repositories…</span>
      </div>
    );
  }

  if (!activeRepository && gitStatus && !gitStatus.isRepo) {
    return (
      <NoGitRepoEmptyState
        initLoading={initLoading}
        onInitialize={handleInitializeRepo}
      />
    );
  }

  // ── Main Render ───────────────────────────────────────────


  return (
    <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-[var(--bg-sidebar)] font-sans text-xs select-none relative">
      <SourceControlHeader
        subprojects={subprojects}
        activeRepo={activeRepo}
        repositories={repositories}
        activeRepository={activeRepository}
        rootPath={rootPath}
        gitStatus={gitStatus}
        isLoading={isRepoDataLoading}
        headLabel={headLabel}
        disableBranchOnlyActions={disableBranchOnlyActions}
        branchOnlyActionsReason={branchOnlyActionsReason}
        submoduleActionLoading={submoduleActionLoading}
        onInitSubmodule={() => handleSubmoduleAction("init")}
        onUpdateSubmodule={() => handleSubmoduleAction("update")}
        onSyncSubmodule={() => handleSubmoduleAction("sync")}
        localBranches={localBranches}
        remoteBranches={remoteBranches}
        showBranchPopover={showBranchPopover}
        onRepoChange={handleRepoChange}
        onOpenGraph={handleOpenGraph}
        onAbortPending={handleAbortPending}
        onToggleBranchPopover={handleBranchPopoverToggle}
        onCheckoutBranch={handleCheckoutBranch}
        onCreateBranch={handleCreateBranch}
        onDeleteBranch={handleDeleteBranch}
        onMergeBranch={handleMergeBranch}
        onRebaseBranch={handleRebaseBranch}
        onCloseBranchPopover={handleCloseBranchPopover}
      />

      {gitStatus && (
        <SourceControlConflictBanner
          gitStatus={gitStatus}
          onOpenConflicts={handleOpenConflicts}
          onComplete={handleCompletePending}
          onAbort={handleAbortPending}
        />
      )}

      {gitStatus && (
        <SourceControlCommitBox
          commitMsg={commitMsg}
          isCommitting={isCommitting}
          isPushing={isPushing}
          isPulling={isPulling}
          totalChanges={totalChanges}
          disablePushPull={disableBranchOnlyActions}
          disablePushPullReason={branchOnlyActionsReason}
          onCommitMsgChange={setCommitMsg}
          onCommit={handleCommit}
          onPull={handlePull}
          onPush={handlePush}
        />
      )}

      {gitStatus && (
        <SourceControlChangeList
          gitStatus={gitStatus}
          activeRepo={activeRepo}
          modifiedList={modifiedList}
          untrackedList={untrackedList}
          totalChanges={totalChanges}
          onStageFile={handleStageFile}
          onUnstageFile={handleUnstageFile}
          onDiscardChanges={handleDiscardChanges}
          onDiscardAllChanges={handleDiscardAllChanges}
          onAddToGitignore={handleAddToGitignore}
          onUndoRename={handleUndoRename}
          onOpenFileDiff={handleOpenFileDiff}
          onOpenConflicts={handleOpenConflicts}
          onFileContextMenu={handleFileContextMenu}
        />
      )}

      {gitStatus && (
        <SourceControlHistory
          historyCommits={historyCommits}
          isExpanded={isHistoryExpanded}
          onToggleExpand={() => setIsHistoryExpanded(!isHistoryExpanded)}
          onOpenGraph={handleOpenGraph}
        />
      )}

      {ConfirmModalComponent}

      {fileContextMenu && (
        <GitFileContextMenu
          x={fileContextMenu.x}
          y={fileContextMenu.y}
          file={fileContextMenu.file}
          onAddToGit={async () => {
            setFileContextMenu(null);
            try {
              await gitService.stageFile(
                activeRepo,
                fileContextMenu.file.path,
              );
              await loadRepoData();
            } catch (err) {
              console.error(err);
            }
          }}
          onAddToGitignore={() => {
            setFileContextMenu(null);
            handleAddToGitignore(fileContextMenu.file.path);
          }}
        />
      )}
    </div>
  );
};

export { SourceControl };
