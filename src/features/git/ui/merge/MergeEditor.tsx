import React from "react";
import Editor from "@monaco-editor/react";
import { ArrowDown, ArrowUp, Check } from "lucide-react";
import { useWorkspaceStore } from "../../../../store";
import { Button } from "../../../../lib/ui/Button/Button";
import { createMonacoEditorOptions } from "../../../editor";
import { getFileTypeDetails } from "../../../editor/ui";
import type { ConflictFile } from "../../model";
import type { MergeDraft } from "./useMergeConflicts";
import { useMergePanes } from "./useMergePanes";
import styles from "./GitMergeTab.module.css";

interface MergeEditorProps {
  file: ConflictFile;
  localLabel: string;
  incomingLabel: string;
  draft: MergeDraft | undefined;
  busy: boolean;
  onDraftChange: (draft: MergeDraft) => void;
  onMarkResolved: (text: string) => void;
}

/** Word wrap and folding change how tall a line is, which would break the panes' alignment. */
const PANE_OPTIONS = {
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  wordWrap: "off",
  folding: false,
  glyphMargin: false,
  stickyScroll: { enabled: false },
  lineNumbersMinChars: 3,
} as const;

/** One file's three-way merge: the local version, the result being built, and the incoming version. */
export const MergeEditor: React.FC<MergeEditorProps> = ({ file, localLabel, incomingLabel, draft, busy, onDraftChange, onMarkResolved }) => {
  const editorFontSize = useWorkspaceStore((state) => state.typographyPreferences.editorFontSize);
  const panes = useMergePanes({ file, localLabel, incomingLabel, draft, onDraftChange });
  const language = getFileTypeDetails(file.path).language;
  const sideOptions = createMonacoEditorOptions(editorFontSize, { ...PANE_OPTIONS, readOnly: true, renderLineHighlight: "none" });
  const resultOptions = createMonacoEditorOptions(editorFontSize, PANE_OPTIONS);
  const remaining = panes.unresolved.length;

  return (
    <div className={styles.merge}>
      <div className={styles.fileBar}>
        <span className={styles.filePath} title={file.relativePath}>{file.relativePath}</span>
        <span className={styles.fileCount}>
          {panes.conflictCount === 0
            ? "No conflicting lines"
            : remaining === 0
              ? "All conflicts decided"
              : `${remaining} of ${panes.conflictCount} ${panes.conflictCount === 1 ? "conflict" : "conflicts"} left`}
        </span>
        <span className={styles.barSpacer} />
        <Button variant="ghost" icon={<ArrowUp size={12} />} disabled={remaining === 0} aria-label="Previous conflict" onClick={() => panes.goToConflict(-1)} />
        <Button variant="ghost" icon={<ArrowDown size={12} />} disabled={remaining === 0} aria-label="Next conflict" onClick={() => panes.goToConflict(1)} />
        <Button variant="ghost" disabled={remaining === 0} onClick={() => panes.acceptAll("local")}>All from {localLabel}</Button>
        <Button variant="ghost" disabled={remaining === 0} onClick={() => panes.acceptAll("incoming")}>All from {incomingLabel}</Button>
        <Button
          variant="primary"
          icon={<Check size={12} />}
          disabled={busy || remaining > 0}
          title={remaining > 0 ? "Decide every conflict first" : "Save the result and mark the file resolved"}
          onClick={() => onMarkResolved(panes.resultText())}
        >
          Mark Resolved
        </Button>
      </div>

      {panes.settledOnDisk && (
        <div className={styles.notice}>
          <span>This file has no conflict markers left on disk, so it may already be fixed by hand.</span>
          <Button disabled={busy} onClick={() => onMarkResolved(file.working ?? "")}>Use the File on Disk</Button>
        </div>
      )}

      <div className={styles.paneHeads}>
        <span className={styles.paneHead}>Local · {localLabel}</span>
        <span className={styles.paneHead}>Result</span>
        <span className={styles.paneHead}>Incoming · {incomingLabel}</span>
      </div>
      <div className={styles.panes}>
        <div className={styles.pane}>
          <Editor height="100%" language={language} theme="rusty-custom-theme" value={file.local ?? ""} options={sideOptions} onMount={panes.mountLocal} />
        </div>
        <div className={styles.paneResult}>
          <Editor height="100%" language={language} theme="rusty-custom-theme" defaultValue={panes.openingText} options={resultOptions} onMount={panes.mountResult} />
        </div>
        <div className={styles.pane}>
          <Editor height="100%" language={language} theme="rusty-custom-theme" value={file.incoming ?? ""} options={sideOptions} onMount={panes.mountIncoming} />
        </div>
      </div>
    </div>
  );
};
