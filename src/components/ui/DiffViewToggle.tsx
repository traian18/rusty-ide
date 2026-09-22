import React from "react";
import { Columns2, ArrowUpDown } from "lucide-react";
import { DiffViewMode } from "../../hooks/useDiffViewMode";
import styles from "./DiffViewToggle.module.css";

interface DiffViewToggleProps {
  viewMode: DiffViewMode;
  isAutoMode: boolean;
  onToggle: () => void;
  onEnableAuto: () => void;
}

export const DiffViewToggle: React.FC<DiffViewToggleProps> = ({
  viewMode,
  isAutoMode,
  onToggle,
  onEnableAuto,
}) => {
  return (
    <div className={styles.root}>
      <button
        type="button"
        onClick={onEnableAuto}
        className={`${styles.button} ${isAutoMode ? styles.active : ""}`}
        title="Auto: automatically switch based on screen width"
      >
        Auto
      </button>
      <button
        type="button"
        onClick={onToggle}
        className={`${styles.button} ${!isAutoMode && viewMode === "side-by-side" ? styles.active : ""}`}
        title="Side by side"
      >
        <Columns2 size={12} />
      </button>
      <button
        type="button"
        onClick={onToggle}
        className={`${styles.button} ${!isAutoMode && viewMode === "inline" ? styles.active : ""}`}
        title="Inline (one above the other)"
      >
        <ArrowUpDown size={12} />
      </button>
    </div>
  );
};
