import React from "react";
import { Button } from "../../../../lib/ui/Button/Button";
import type { ConflictFile, ConflictSide } from "../../model";
import styles from "./GitMergeTab.module.css";

interface WholeFileConflictProps {
  file: ConflictFile;
  localLabel: string;
  incomingLabel: string;
  busy: boolean;
  onKeep: (side: ConflictSide) => void;
}

function explanation(file: ConflictFile, localLabel: string, incomingLabel: string): string {
  if (file.kind === "local-only") return `${localLabel} changed this file, but ${incomingLabel} deleted it.`;
  if (file.kind === "incoming-only") return `${incomingLabel} changed this file, but ${localLabel} deleted it.`;
  if (file.kind === "both-deleted") return "Both sides removed this file.";
  return "Both sides changed this file, and it cannot be merged line by line. Keep one version.";
}

/** A conflict with no lines to choose between: binary or too large, or deleted on a side. */
export const WholeFileConflict: React.FC<WholeFileConflictProps> = ({ file, localLabel, incomingLabel, busy, onKeep }) => {
  const label = (side: ConflictSide, name: string) => {
    const deletes = (side === "local" && file.kind === "incoming-only")
      || (side === "incoming" && file.kind === "local-only")
      || file.kind === "both-deleted";
    return deletes ? `Delete, as in ${name}` : `Keep ${name}`;
  };
  return (
    <div className={styles.whole}>
      <strong className={styles.wholePath}>{file.relativePath}</strong>
      <p className={styles.wholeText}>{explanation(file, localLabel, incomingLabel)}</p>
      <div className={styles.wholeActions}>
        <Button disabled={busy} onClick={() => onKeep("local")}>{label("local", localLabel)}</Button>
        <Button disabled={busy} onClick={() => onKeep("incoming")}>{label("incoming", incomingLabel)}</Button>
      </div>
    </div>
  );
};
