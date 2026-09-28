import React, { useMemo, useSyncExternalStore } from "react";
import { CircleAlert, ShieldCheck } from "lucide-react";
import { useWorkspaceStore } from "../../store";
import { Button } from "../ui/Button/Button";
import { findOpenRouterJevProvider } from "../../services/intelligentModelSelector";
import { jevReviewStats, summarizeJevReviewsByModel } from "../../services/jevReviewStats";
import styles from "./IntelligentModelSelectionSettings.module.css";

function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–";
}

export const JevRiskReviewSettings: React.FC = () => {
  const settings = useWorkspaceStore((state) => state.intelligentModelSelectionSettings);
  const updateSettings = useWorkspaceStore((state) => state.updateIntelligentModelSelectionSettings);
  const providers = useWorkspaceStore((state) => state.customProviders);
  const hasJev = Boolean(findOpenRouterJevProvider(providers, settings.jevModelId));
  const entries = useSyncExternalStore(jevReviewStats.subscribe, jevReviewStats.getEntries);
  const summaries = useMemo(() => summarizeJevReviewsByModel(entries), [entries]);
  const threshold = `${Math.round(settings.decisionConfidenceThreshold * 100)}%`;

  return (
    <section className={styles.section} aria-labelledby="jev-risk-review-title">
      <div className={styles.heading}>
        <div className={styles.headingCopy}>
          <div className={styles.titleRow}>
            <ShieldCheck aria-hidden="true" size={16} />
            <h3 className={styles.title} id="jev-risk-review-title">JEV review of risky actions (experimental)</h3>
          </div>
          <p className={styles.description}>
            Enforced. Before an agent overwrites a file in a way that would destroy existing content (emptying it, dropping at least half of it, or leaving a "rest of the file unchanged" placeholder) or runs a destructive command, JEV reviews the step. Proceed at {threshold} confidence or more lets it run; Revise blocks it and tells the agent why; Stop or an unsure review asks you (commands still always ask you). Without a user to ask, such a write is blocked. Other actions are never delayed. Applies from the next run.
          </p>
        </div>
        <label className={styles.toggleLabel} htmlFor="jev-risk-review-enabled">
          <input
            className={styles.toggleInput}
            id="jev-risk-review-enabled"
            type="checkbox"
            checked={settings.riskReviewEnabled && hasJev}
            disabled={!hasJev}
            onChange={(event) => updateSettings({ riskReviewEnabled: event.target.checked })}
          />
          <span className={styles.toggleTrack} aria-hidden="true"><span /></span>
          <span>Enabled</span>
        </label>
      </div>

      {!hasJev && (
        <div className={styles.statusWarning} role="status">
          <CircleAlert aria-hidden="true" size={14} />
          <span>Connect OpenRouter and choose a JEV decision model under Intelligent model selection first.</span>
        </div>
      )}

      {summaries.length > 0 ? (
        <div className={styles.field}>
          <div className={styles.shadowTableWrap}>
            <table className={styles.shadowTable}>
              <thead>
                <tr>
                  <th scope="col">Model</th>
                  <th scope="col">Reviewed</th>
                  <th scope="col">Allowed</th>
                  <th scope="col">Blocked</th>
                  <th scope="col">You allowed</th>
                  <th scope="col">You blocked</th>
                  <th scope="col">Blocked (no user)</th>
                  <th scope="col">JEV cost</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((summary) => (
                  <tr key={summary.model}>
                    <th scope="row">{summary.model}</th>
                    <td>{summary.reviewed}{summary.errors > 0 ? ` (${summary.errors} unreviewed)` : ""}</td>
                    <td>{percent(summary.outcomes.allowed, summary.reviewed)}</td>
                    <td>{percent(summary.outcomes.blocked, summary.reviewed)}</td>
                    <td>{percent(summary.outcomes.user_allowed, summary.reviewed)}</td>
                    <td>{percent(summary.outcomes.user_blocked, summary.reviewed)}</td>
                    <td>{percent(summary.outcomes.blocked_unattended, summary.reviewed)}</td>
                    <td>${summary.cost.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.fieldHint}>
            If you often allow what JEV flagged, the review is too strict for that model; if you often block it, it is catching real mistakes.
          </p>
          <div>
            <Button variant="ghost" onClick={() => jevReviewStats.clear()}>Clear results</Button>
          </div>
        </div>
      ) : (
        <p className={styles.fieldHint}>No risky actions reviewed yet.</p>
      )}
    </section>
  );
};
