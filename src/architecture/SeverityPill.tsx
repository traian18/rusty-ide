import type { Severity } from "./model";
import styles from "./Architecture.module.css";

const LABELS: Record<Severity, string> = { high: "high", medium: "medium", low: "low", info: "info" };

/** A severity label, or a count of findings at that severity. */
export function SeverityPill({ severity, count }: { severity: Severity; count?: number }) {
  const text = count === undefined ? LABELS[severity] : String(count);
  const label = count === undefined ? `${severity} severity` : `${count} ${severity} severity finding${count === 1 ? "" : "s"}`;
  return (
    <span className={`${styles.pill} ${styles[`severity_${severity}`]}`} aria-label={label} title={label}>
      {text}
    </span>
  );
}
