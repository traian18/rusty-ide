import type { SpecWarning } from "./model";
import styles from "./Specs.module.css";

/** Problems found in the documents; a click opens the file at the line. */
export function Warnings({ warnings, onOpen }: { warnings: readonly SpecWarning[]; onOpen(file: string, line?: number): void }) {
  if (!warnings.length) return null;
  return (
    <ul className={styles.warnings} aria-label="Warnings">
      {warnings.map((warning, index) => (
        <li key={`${warning.file}:${warning.line ?? 0}:${index}`}>
          <button type="button" className={styles.warning} title={`Open ${warning.file}`} onClick={() => onOpen(warning.file, warning.line ?? undefined)}>
            <span className={styles.severity}>{warning.severity}</span>
            <span>
              {warning.message}
              <span className={styles.muted}>
                {" "}
                · {warning.file.split("/").pop()}
                {warning.line ? `:${warning.line}` : ""}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
