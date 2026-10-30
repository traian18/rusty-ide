import React from "react";
import { FileJson, RotateCcw, Trash2 } from "lucide-react";
import { IconButton } from "../../../lib/ui";
import styles from "./Behaviors.module.css";

export const InspectorHeader: React.FC<{
  title: string;
  showJson: boolean;
  onToggleJson: () => void;
  canEdit: boolean;
  dirty: boolean;
  onRevert: () => void;
  onDelete: () => void;
}> = ({ title, showJson, onToggleJson, canEdit, dirty, onRevert, onDelete }) => (
  <div className={styles.inspectorHeader}>
    <span className={styles.inspectorTitle}>{title}</span>
    <IconButton icon={<FileJson size={14} />} label={showJson ? "Show form" : "Edit as JSON"} size="sm" selected={showJson} onClick={onToggleJson} />
    {canEdit ? (
      <>
        <IconButton icon={<RotateCcw size={14} />} label="Revert unsaved changes" size="sm" disabled={!dirty} onClick={onRevert} />
        <IconButton icon={<Trash2 size={14} />} label="Delete file" size="sm" onClick={onDelete} />
      </>
    ) : null}
  </div>
);
