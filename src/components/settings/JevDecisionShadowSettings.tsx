import React, { useMemo, useSyncExternalStore } from "react";
import { CircleAlert, Scale } from "lucide-react";
import { useWorkspaceStore } from "../../store";
import { Button } from "../ui/Button/Button";
import { findOpenRouterJevProvider } from "../../services/intelligentModelSelector";
import { jevShadowStats, summarizeJevShadowByModel } from "../../services/jevShadowStats";
import styles from "./IntelligentModelSelectionSettings.module.css";

function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–";
}

export const JevDecisionShadowSettings: React.FC = () => {
  const settings = useWorkspaceStore((state) => state.intelligentModelSelectionSettings);
  const updateSettings = useWorkspaceStore((state) => state.updateIntelligentModelSelectionSettings);
  const providers = useWorkspaceStore((state) => state.customProviders);
  const hasJev = Boolean(findOpenRouterJevProvider(providers, settings.jevModelId));
  const entries = useSyncExternalStore(jevShadowStats.subscribe, jevShadowStats.getEntries);
  const summaries = useMemo(() => summarizeJevShadowByModel(entries), [entries]);

  return (
    <section className={styles.section} aria-labelledby="jev-decision-shadow-title">
      <div className={styles.heading}>
        <div className={styles.headingCopy}>
          <div className={styles.titleRow}>
            <Scale aria-hidden="true" size={16} />
            <h3 className={styles.title} id="jev-decision-shadow-title">JEV decision review (experimental)</h3>
          </div>
          <p className={styles.description}>
            JEV scores every tool call any model makes as Proceed, Revise, or Stop. Shadow mode only: the call always runs, and the verdict is recorded on the call in Tool Execution Observability. Each scored call is one Decisions API request.
          </p>
        </div>
        <label className={styles.toggleLabel} htmlFor="jev-decision-shadow-enabled">
          <input
            className={styles.toggleInput}
            id="jev-decision-shadow-enabled"
            type="checkbox"
            checked={settings.decisionShadowEnabled && hasJev}
            disabled={!hasJev}
            onChange={(event) => updateSettings({ decisionShadowEnabled: event.target.checked })}
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
                  <th scope="col">Scored</th>
                  <th scope="col">Proceed</th>
                  <th scope="col">Revise</th>
                  <th scope="col">Stop</th>
                  <th scope="col">Failed after Proceed</th>
                  <th scope="col">Failed after flag</th>
                  <th scope="col">JEV cost</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((summary) => (
                  <tr key={summary.model}>
                    <th scope="row">{summary.model}</th>
                    <td>{summary.scored}{summary.errors > 0 ? ` (+${summary.errors} unscored)` : ""}</td>
                    <td>{percent(summary.verdicts.proceed, summary.scored)}</td>
                    <td>{percent(summary.verdicts.revise, summary.scored)}</td>
                    <td>{percent(summary.verdicts.stop, summary.scored)}</td>
                    <td>{percent(summary.proceedFailed, summary.proceedFinished)}</td>
                    <td>{percent(summary.flaggedFailed, summary.flaggedFinished)}</td>
                    <td>${summary.cost.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.fieldHint}>
            "Flag" means Revise or Stop. If calls JEV flags fail much more often than calls it lets proceed, enforcing its verdict would likely help that model. Tool failures only catch some bad decisions: a call can succeed and still be the wrong step.
          </p>
          <div>
            <Button variant="ghost" onClick={() => jevShadowStats.clear()}>Clear results</Button>
          </div>
        </div>
      ) : (
        <p className={styles.fieldHint}>No tool calls scored yet.</p>
      )}
    </section>
  );
};
