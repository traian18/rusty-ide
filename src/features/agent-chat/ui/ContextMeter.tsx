import type { ContextEstimate } from "../../../harness/contract";
import { estimateText } from "../contextVisibility";
import styles from "./ContextMeter.module.css";

/** Where the bar changes colour: the points at which rusty-core starts a background summary and
 * compacts before sending (`ContextPolicy`'s soft and hard limits). */
const WARN_AT = 70;
const FULL_AT = 85;

const tokens = (count: number) => count.toLocaleString("en-US");

function level(percent: number): "ok" | "warn" | "full" {
  if (percent >= FULL_AT) return "full";
  return percent >= WARN_AT ? "warn" : "ok";
}

function note(percent: number): string {
  if (percent >= FULL_AT) return "Nearly full: older context is compacted before the next request.";
  if (percent >= WARN_AT) return "Filling up: older context is being summarized in the background.";
  return "Room to spare.";
}

/** The latest request's context use as a small bar; hovering or focusing it shows the breakdown. */
export function ContextMeter({ estimate }: { estimate: ContextEstimate | null }) {
  if (!estimate) return null;
  const percent = Math.max(0, Math.min(100, Math.round(estimate.usagePercent)));
  return (
    <span className={styles.wrapper}>
      <span
        id="agent-context-estimate"
        className={styles.meter}
        role="meter"
        tabIndex={0}
        aria-label="Context"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={estimateText(estimate)}
        aria-describedby="agent-context-details"
        data-level={level(percent)}
      >
        <span className={styles.track} aria-hidden="true">
          <span className={styles.fill} style={{ width: `${percent}%` }} />
        </span>
        <span className={styles.percent} aria-hidden="true">{percent}%</span>
      </span>
      <span id="agent-context-details" role="tooltip" className={styles.bubble}>
        <span className={styles.heading}>
          <span>Context</span>
          <span className={styles.headingValue}>{percent}% used</span>
        </span>
        <span className={styles.bubbleTrack} aria-hidden="true">
          <span className={styles.fill} style={{ width: `${percent}%` }} />
        </span>
        <span className={styles.rows}>
          <span className={styles.label}>Used</span><span className={styles.value}>{tokens(estimate.estimatedInputTokens)}</span>
          <span className={styles.label}>Remaining</span><span className={styles.value}>{tokens(estimate.remainingInputTokens)}</span>
          <span className={styles.label}>Input budget</span><span className={styles.value}>{tokens(estimate.inputBudget)}</span>
          <span className={styles.label}>Model window</span><span className={styles.value}>{tokens(estimate.modelWindow)}</span>
        </span>
        <span className={styles.note}>{note(percent)}</span>
        <span className={styles.footer}>Estimated for the latest request on {estimate.model}, in tokens.</span>
      </span>
    </span>
  );
}
