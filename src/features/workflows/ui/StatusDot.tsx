import React from "react";
import { type Issue } from "../model";
import styles from "./Behaviors.module.css";

export const StatusDot: React.FC<{ dirty: boolean; issues?: Issue[] }> = ({ dirty, issues }) => {
  const invalid = (issues ?? []).some((issue) => issue.blocking);
  if (invalid) return <span className={`${styles.dot} ${styles.dotError}`} title="Has validation issues" />;
  if (dirty) return <span className={styles.dot} title="Unsaved changes" />;
  return null;
};
