import { Activity } from "lucide-react";
import { useExecutionObservability } from "../../observability/useExecutionObservability";
import styles from "./ToolExecutionPanel.module.css";

export function ToolExecutionButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { records, lastError } = useExecutionObservability();
  const active = records.filter((record) => ["queued", "waiting-permission", "running"].includes(record.status)).length;
  const failures = records.some((record) => record.status === "failed") || Boolean(lastError);
  return (
    <button
      type="button"
      className={`${styles.trigger} ${open ? styles.triggerActive : ""}`}
      aria-label={`Tool execution${active ? `, ${active} active` : ""}`}
      aria-expanded={open}
      aria-controls="tool-execution-panel"
      onClick={onToggle}
      title="Tool execution (⌘⇧E)"
    >
      <Activity size={15} aria-hidden="true" />
      <span className={styles.triggerLabel}>Tools</span>
      {active > 0 && <span className={styles.activeBadge}>{active > 99 ? "99+" : active}</span>}
      {active === 0 && failures && <span className={styles.errorDot} aria-label="Execution errors present" />}
    </button>
  );
}
