import React from "react";
import { AlertTriangle, Check, CircleSlash, GitMerge } from "lucide-react";
import type { TabOfType } from "../../../../app/tabs/types";
import { Button } from "../../../../lib/ui/Button/Button";
import type { ConflictEntry, ConflictState } from "../../model";
import { MergeEditor } from "./MergeEditor";
import { WholeFileConflict } from "./WholeFileConflict";
import { useMergeConflicts } from "./useMergeConflicts";
import styles from "./GitMergeTab.module.css";

const OPERATION_VERBS: Record<NonNullable<ConflictState["operation"]>, string> = {
  merge: "Merging",
  rebase: "Rebasing",
  "cherry-pick": "Cherry-picking",
  revert: "Reverting",
};

const COMPLETE_LABELS: Record<NonNullable<ConflictState["operation"]>, string> = {
  merge: "Complete Merge",
  rebase: "Continue Rebase",
  "cherry-pick": "Continue Cherry-pick",
  revert: "Continue Revert",
};

function operationTitle({ operation, localLabel, incomingLabel }: ConflictState): React.ReactNode {
  if (!operation) return <>Conflicts from applying <strong>{incomingLabel}</strong></>;
  if (operation === "rebase") return <>Rebasing <strong>{localLabel}</strong> onto <strong>{incomingLabel}</strong></>;
  return <>{OPERATION_VERBS[operation]} <strong>{incomingLabel}</strong> into <strong>{localLabel}</strong></>;
}

const directoryOf = (entry: ConflictEntry) => entry.relativePath.slice(0, -entry.name.length).replace(/\/$/, "");

/**
 * The merge window: every file git could not merge, each resolved in three
 * panes, then the operation finished or abandoned. A tab rather than a dialog
 * so the rest of the app stays usable while reading the code around a conflict.
 */
export const GitMergeTab: React.FC<{ tab: TabOfType<"git-merge"> }> = ({ tab }) => {
  const merge = useMergeConflicts(tab.repoPath, tab.path, tab.id);
  const { conflicts, file, selectedPath, busy } = merge;

  if (!conflicts) {
    return <div className={styles.empty}>{merge.loadError ?? "Reading conflicts…"}</div>;
  }

  const remaining = conflicts.files.length;
  const canComplete = remaining === 0 && conflicts.operation !== null;
  const selectedEntry = conflicts.files.find((entry) => entry.path === selectedPath);
  const openFile = file && file.path === selectedPath ? file : null;

  return (
    <div className={styles.tab}>
      <header className={styles.bar}>
        <GitMerge size={14} className={styles.barIcon} aria-hidden="true" />
        <span className={styles.barTitle}>{operationTitle(conflicts)}</span>
        <span className={remaining > 0 ? styles.countOpen : styles.countDone}>
          {remaining > 0 ? `${remaining} ${remaining === 1 ? "file" : "files"} left` : "All resolved"}
        </span>
        <span className={styles.barSpacer} />
        {conflicts.operation && (
          <Button variant="ghost" icon={<CircleSlash size={12} />} disabled={busy} onClick={merge.abort}>
            Abort
          </Button>
        )}
        {conflicts.operation && (
          <Button
            variant="primary"
            icon={<Check size={12} />}
            disabled={!canComplete || busy}
            title={canComplete ? undefined : "Resolve every file first"}
            onClick={merge.complete}
          >
            {COMPLETE_LABELS[conflicts.operation]}
          </Button>
        )}
      </header>

      {remaining === 0 ? (
        <div className={styles.empty}>
          <Check size={20} className={styles.doneIcon} aria-hidden="true" />
          {conflicts.operation ? (
            <span>Every conflict is resolved. {COMPLETE_LABELS[conflicts.operation]} to finish.</span>
          ) : (
            <span>No conflicts in this repository.</span>
          )}
        </div>
      ) : (
        <div className={styles.body}>
          <nav className={styles.files} aria-label="Conflicted files">
            {conflicts.files.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className={entry.path === selectedPath ? styles.fileActive : styles.file}
                aria-current={entry.path === selectedPath ? "true" : undefined}
                title={entry.relativePath}
                onClick={() => merge.setSelectedPath(entry.path)}
              >
                <AlertTriangle size={11} className={styles.fileIcon} aria-hidden="true" />
                <span className={styles.fileName}>{entry.name}</span>
                <span className={styles.fileDir}>{directoryOf(entry)}</span>
              </button>
            ))}
          </nav>
          <div className={styles.editor}>
            {openFile && selectedEntry ? (
              openFile.kind === "content" && !openFile.binary ? (
                <MergeEditor
                  key={openFile.path}
                  file={openFile}
                  localLabel={conflicts.localLabel}
                  incomingLabel={conflicts.incomingLabel}
                  draft={merge.draftFor(openFile.path)}
                  busy={busy}
                  onDraftChange={(draft) => merge.saveDraft(openFile.path, draft)}
                  onMarkResolved={(text) => merge.markResolved(openFile, text)}
                />
              ) : (
                <WholeFileConflict
                  file={openFile}
                  localLabel={conflicts.localLabel}
                  incomingLabel={conflicts.incomingLabel}
                  busy={busy}
                  onKeep={(side) => merge.keepSide(openFile, side)}
                />
              )
            ) : (
              <div className={styles.empty}>Reading file…</div>
            )}
          </div>
        </div>
      )}
      {merge.ConfirmModalComponent}
    </div>
  );
};
