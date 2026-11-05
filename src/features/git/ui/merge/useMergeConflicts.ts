import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspaceStore } from "../../../../store";
import { notify } from "../../../notifications";
import { useConfirm } from "../../../../lib/ui/useConfirm";
import { gitClient } from "../../client";
import { gitErrorMessage } from "../../gitErrors";
import type { ChunkChoice, LineRange } from "../../mergeModel";
import type { ConflictFile, ConflictSide, ConflictState } from "../../model";
import { gitService } from "../gitService";

/** A file's unfinished merge, kept while another file is on screen. */
export interface MergeDraft {
  text: string;
  ranges: LineRange[];
  choices: ChunkChoice[];
}

/**
 * What the merge window shows and does for one repository. The list comes from
 * git and is reloaded whenever the repository's status changes, so a file
 * resolved or changed elsewhere (a terminal, an agent) drops out by itself.
 */
export function useMergeConflicts(repoPath: string, requestedPath: string | undefined, tabId: string) {
  const closeTab = useWorkspaceStore((state) => state.closeTab);
  const statusKey = useWorkspaceStore((state) => {
    const repository = state.repositories.find((candidate) => candidate.worktreePath === repoPath);
    const status = repository ? state.statusByRepositoryId[repository.id] : state.gitStatus;
    if (!status) return "";
    return `${status.pendingOperation}:${status.conflicted.map((file) => file.path).join("\0")}`;
  });

  const [conflicts, setConflicts] = useState<ConflictState | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [file, setFile] = useState<ConflictFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const drafts = useRef(new Map<string, MergeDraft>());
  const { confirm, ConfirmModalComponent } = useConfirm();

  const refresh = useCallback(async (): Promise<ConflictState | null> => {
    try {
      const state = await gitClient.conflictState(repoPath);
      setConflicts(state);
      setLoadError(null);
      setSelectedPath((current) =>
        state.files.some((entry) => entry.path === current) ? current : state.files[0]?.path ?? null);
      return state;
    } catch (err) {
      setLoadError(gitErrorMessage(err));
      return null;
    }
  }, [repoPath]);

  useEffect(() => {
    void refresh();
  }, [refresh, statusKey]);

  useEffect(() => {
    if (requestedPath) setSelectedPath(requestedPath);
  }, [requestedPath]);

  useEffect(() => {
    if (!selectedPath) {
      setFile(null);
      return;
    }
    let cancelled = false;
    gitClient.conflictFile(repoPath, selectedPath).then(
      (loaded) => {
        if (!cancelled) setFile(loaded);
      },
      (err) => {
        // Resolved elsewhere between the list loading and this read.
        if (!cancelled) setFile(null);
        console.warn("Failed to read conflicted file:", err);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [repoPath, selectedPath]);

  /** Runs one action, holding the buttons, and reports nothing of its own: the service already has. */
  const run = useCallback(async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }, []);

  /** The file may have been saved elsewhere since it was opened here; don't overwrite that unasked. */
  const confirmNotChangedOnDisk = useCallback(async (opened: ConflictFile): Promise<boolean> => {
    const current = await gitClient.conflictFile(repoPath, opened.path);
    if (current.working === opened.working) return true;
    return confirm({
      title: "File Changed on Disk",
      message: `${opened.relativePath} changed after this merge was opened. Replace it with the result shown here?`,
      kind: "warning",
    });
  }, [confirm, repoPath]);

  const markResolved = useCallback((opened: ConflictFile, text: string): Promise<void> => run(async () => {
    if (!await confirmNotChangedOnDisk(opened)) return;
    await gitService.resolveConflict(repoPath, opened.path, text);
    drafts.current.delete(opened.path);
    await refresh();
  }), [confirmNotChangedOnDisk, refresh, repoPath, run]);

  const keepSide = useCallback((opened: ConflictFile, side: ConflictSide): Promise<void> => run(async () => {
    await gitService.resolveConflictSide(repoPath, opened.path, side);
    drafts.current.delete(opened.path);
    await refresh();
  }), [refresh, repoPath, run]);

  const closeIfFinished = useCallback((state: ConflictState | null) => {
    if (state && !state.operation && state.files.length === 0) closeTab(tabId);
  }, [closeTab, tabId]);

  const complete = useCallback((): Promise<void> => run(async () => {
    await gitService.completePending(repoPath);
    closeIfFinished(await refresh());
  }), [closeIfFinished, refresh, repoPath, run]);

  const abort = useCallback((): Promise<void> => run(async () => {
    const confirmed = await confirm({
      title: "Abort",
      message: "Stop here and put the repository back as it was? Decisions made in this window are lost.",
      kind: "danger",
    });
    if (!confirmed) return;
    await gitService.abortPending(repoPath);
    drafts.current.clear();
    closeIfFinished(await refresh());
  }), [closeIfFinished, confirm, refresh, repoPath, run]);

  const saveDraft = useCallback((path: string, draft: MergeDraft) => {
    drafts.current.set(path, draft);
  }, []);

  useEffect(() => {
    if (loadError) notify("Conflicts Unavailable", loadError, "error");
  }, [loadError]);

  return {
    conflicts,
    selectedPath,
    setSelectedPath,
    file,
    busy,
    loadError,
    draftFor: (path: string) => drafts.current.get(path),
    saveDraft,
    markResolved,
    keepSide,
    complete,
    abort,
    ConfirmModalComponent,
  };
}
