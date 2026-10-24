import { Button } from "../components/ui";
import type { OnboardingEntry } from "./model";
import styles from "./Specs.module.css";

export interface OnboardingCardProps {
  entries: readonly OnboardingEntry[];
  /** Writes (or rewrites) one capability's spec in an Agent tab the person sends. */
  onWrite(entry: OnboardingEntry): void;
  /** Writes every listed capability that has no spec yet, one after another. */
  onWriteRemaining(entries: readonly OnboardingEntry[]): void;
  onEditList(): void;
  onSurveyAgain(): void;
}

/** The survey's capability list of an existing project, with the spec of each one written on request. */
export function OnboardingCard({ entries, onWrite, onWriteRemaining, onEditList, onSurveyAgain }: OnboardingCardProps) {
  const remaining = entries.filter((entry) => !entry.written);
  return (
    <section className={styles.card} aria-label="Onboarding">
      <header className={styles.header}>
        <h3 className={styles.title}>Onboarding</h3>
        <span className={styles.badge}>
          {entries.length - remaining.length} of {entries.length} capability specs written
        </span>
        <span style={{ flex: 1 }} />
        <Button variant="ghost" onClick={onSurveyAgain} title="Survey the code again; the list you edited is kept and revised">
          Survey again
        </Button>
        <Button variant="ghost" onClick={onEditList}>
          Edit onboarding.md
        </Button>
        <Button variant="primary" disabled={!remaining.length} onClick={() => onWriteRemaining(remaining)} title="Writes each missing spec in its own run, one after another, in one Agent tab">
          {remaining.length ? `Write all remaining (${remaining.length})` : "All written"}
        </Button>
      </header>
      {entries.length ? (
        <p className={styles.muted}>Review the list first: edit onboarding.md to rename, remove or add capabilities, or change the paths each one is read from.</p>
      ) : (
        <p className={styles.muted}>The list has no capabilities. Edit onboarding.md (a “## name” section with Purpose: and Paths:) or survey the project again.</p>
      )}
      <ul className={styles.entries} aria-label="Capabilities to write">
        {entries.map((entry) => (
          <li key={entry.name} className={styles.entry}>
            <div className={styles.taskBody}>
              <div className={styles.taskTitle}>
                <strong>{entry.title}</strong> <span className={styles.muted}>{entry.written ? "Written" : "Not written"}</span>
              </div>
              {entry.purpose ? <div className={styles.muted}>{entry.purpose}</div> : null}
              {entry.paths.length ? <div className={`${styles.muted} ${styles.mono}`}>{entry.paths.join(", ")}</div> : null}
            </div>
            <Button variant={entry.written ? "ghost" : "secondary"} onClick={() => onWrite(entry)}>
              {entry.written ? "Rewrite" : "Write spec"}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
