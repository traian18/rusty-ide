import React from "react";
import { useWorkflowRunStore } from "../state";
import styles from "./Behaviors.module.css";

export const RunBanner: React.FC<{ run?: ReturnType<typeof useWorkflowRunStore.getState>["runs"][string] }> = ({ run }) => {
  if (!run) return null;
  const label = { running: "Running in Agent Mode…", completed: "Last run completed", failed: "Last run failed", cancelled: "Last run cancelled" }[run.status];
  const badge = { running: styles.badgeRunning, completed: styles.badgeSuccess, failed: styles.badgeDanger, cancelled: styles.badgeWarning }[run.status];
  return (
    <div className={styles.runBanner} role="status">
      <span className={`${styles.badge} ${badge}`}>{run.status}</span>
      <span>{label}</span>
      {run.error ? <span className={styles.runError} title={run.error}>{run.error}</span> : null}
    </div>
  );
};
