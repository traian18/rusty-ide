import { Tooltip } from "../components/ui";
import { useBackground } from "./backgroundStore";
import styles from "./BackgroundIndicator.module.css";

/**
 * The rail's view of background work: a ring that spins while something runs, with the number of
 * processes (and questions) in the middle. A click shows or hides the process bubbles. Nothing is
 * drawn when there is nothing to show.
 */
export function BackgroundIndicator() {
  const jobs = useBackground((state) => state.jobs);
  const questions = useBackground((state) => state.questions);
  const open = useBackground((state) => state.open);
  const toggle = useBackground((state) => state.toggle);
  const count = jobs.length + questions.length;
  if (!count) return null;
  const running = jobs.filter((job) => job.state === "running").length;
  const failed = jobs.some((job) => job.state === "failed");
  const state = failed ? "failed" : questions.length ? "question" : running ? "running" : "idle";
  const what = [running ? `${running} running` : "", questions.length ? `${questions.length} waiting for you` : "", failed ? "a failure to read" : ""].filter(Boolean).join(", ") || `${count} finished`;
  const label = `Background processes: ${what}. ${open ? "Hide" : "Show"} them.`;
  return (
    <Tooltip id="rail-tooltip-background" label={label} placement="right">
      <button type="button" className={styles.indicator} data-state={state} aria-pressed={open} aria-label={label} onClick={toggle}>
        <span className={styles.ring} data-spinning={running > 0 || undefined} aria-hidden />
        <span className={styles.count}>{count > 9 ? "9+" : count}</span>
      </button>
    </Tooltip>
  );
}
