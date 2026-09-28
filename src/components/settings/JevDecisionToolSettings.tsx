import React, { useMemo, useSyncExternalStore } from "react";
import { CircleAlert, Signpost } from "lucide-react";
import { useWorkspaceStore } from "../../store";
import { Button } from "../ui/Button/Button";
import { CustomSelect } from "../CustomSelect";
import { FOLLOW_UP_CALLS } from "../../harness/core/definitions/decideTool";
import { findOpenRouterJevProvider } from "../../services/intelligentModelSelector";
import { calibrateJevDecisions, jevDecisionStats, summarizeJevDecisionsByModel } from "../../services/jevDecisionStats";
import { jevShadowStats } from "../../services/jevShadowStats";
import { DECISION_CONFIDENCE_CHOICES } from "../../store/intelligentModelSelectionTypes";
import styles from "./IntelligentModelSelectionSettings.module.css";

function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–";
}

const wholePercent = (value: number) => `${Math.round(value * 100)}%`;

export const JevDecisionToolSettings: React.FC = () => {
  const settings = useWorkspaceStore((state) => state.intelligentModelSelectionSettings);
  const updateSettings = useWorkspaceStore((state) => state.updateIntelligentModelSelectionSettings);
  const providers = useWorkspaceStore((state) => state.customProviders);
  const hasJev = Boolean(findOpenRouterJevProvider(providers, settings.jevModelId));
  const entries = useSyncExternalStore(jevDecisionStats.subscribe, jevDecisionStats.getEntries);
  const shadowEntries = useSyncExternalStore(jevShadowStats.subscribe, jevShadowStats.getEntries);
  const summaries = useMemo(() => summarizeJevDecisionsByModel(entries, shadowEntries), [entries, shadowEntries]);
  const calibration = useMemo(
    () => calibrateJevDecisions(entries, shadowEntries).filter((bucket) => bucket.decisions > 0),
    [entries, shadowEntries],
  );

  return (
    <section className={styles.section} aria-labelledby="jev-decision-tool-title">
      <div className={styles.heading}>
        <div className={styles.headingCopy}>
          <div className={styles.titleRow}>
            <Signpost aria-hidden="true" size={16} />
            <h3 className={styles.title} id="jev-decision-tool-title">JEV decisions (experimental)</h3>
          </div>
          <p className={styles.description}>
            Agents gather the facts and lay out the options; JEV picks one, seeing the facts and the agent's earlier steps. In AUTO chats, JEV also rates the remaining work, and the chat switches to a more capable level's model on the same provider when JEV is confident it needs one. When JEV is unsure, the agent is sent back for more evidence, and after three attempts the question goes to you (in agent chats) or JEV's best guess is used (in task nodes). Applies from the next run. Each decision is one Decisions API request.
          </p>
        </div>
        <label className={styles.toggleLabel} htmlFor="jev-decision-tool-enabled">
          <input
            className={styles.toggleInput}
            id="jev-decision-tool-enabled"
            type="checkbox"
            checked={settings.decisionToolEnabled && hasJev}
            disabled={!hasJev}
            onChange={(event) => updateSettings({ decisionToolEnabled: event.target.checked })}
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

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="jev-decision-confidence">Act on JEV's pick at confidence</label>
        <CustomSelect
          id="jev-decision-confidence"
          value={String(settings.decisionConfidenceThreshold)}
          onChange={(value) => updateSettings({ decisionConfidenceThreshold: Number(value) })}
          options={DECISION_CONFIDENCE_CHOICES.map((choice) => ({ id: String(choice), name: `${wholePercent(choice)} or higher` }))}
        />
        <p className={styles.fieldHint}>
          Below this, the agent is sent back for more evidence. Lower it when the calibration table shows low-confidence decisions work out as well as confident ones; raise it when they don't.
        </p>
      </div>

      {summaries.length > 0 ? (
        <div className={styles.field}>
          <div className={styles.shadowTableWrap}>
            <table className={styles.shadowTable}>
              <thead>
                <tr>
                  <th scope="col">Model</th>
                  <th scope="col">Decisions</th>
                  <th scope="col">Decided</th>
                  <th scope="col">Sent back</th>
                  <th scope="col">Escalated</th>
                  <th scope="col">Facts insufficient</th>
                  <th scope="col">Avg. confidence</th>
                  <th scope="col">Next calls failed</th>
                  <th scope="col">Next calls flagged</th>
                  <th scope="col">Stepped up</th>
                  <th scope="col">JEV cost</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((summary) => (
                  <tr key={summary.model}>
                    <th scope="row">{summary.model}</th>
                    <td>{summary.decisions}{summary.errors > 0 ? ` (+${summary.errors} failed)` : ""}</td>
                    <td>{percent(summary.bands.proceed, summary.decisions)}</td>
                    <td>{percent(summary.bands.verify, summary.decisions)}</td>
                    <td>{percent(summary.bands.escalate, summary.decisions)}</td>
                    <td>{percent(summary.needMoreContext, summary.decisions)}</td>
                    <td>{summary.averageConfidence === undefined ? "–" : wholePercent(summary.averageConfidence)}</td>
                    <td>{percent(summary.followUpFailed, summary.followUpCalls)}</td>
                    <td>{percent(summary.followUpFlagged, summary.followUpScored)}</td>
                    <td>{summary.steppedUp}</td>
                    <td>${summary.cost.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.fieldHint}>
            "Sent back" and "Facts insufficient" measure how well a model frames its decisions: a high rate means it asks before gathering enough evidence. "Next calls" are the agent's next {FOLLOW_UP_CALLS} tool calls after acting on a decision; "flagged" counts those JEV decision review rated Revise or Stop, so it needs that review turned on.
          </p>

          {calibration.length > 0 && (
            <div className={styles.shadowTableWrap}>
              <table className={styles.shadowTable}>
                <caption className={styles.fieldLabel}>Calibration: decisions acted on, by JEV confidence</caption>
                <thead>
                  <tr>
                    <th scope="col">Confidence</th>
                    <th scope="col">Decisions</th>
                    <th scope="col">Next calls</th>
                    <th scope="col">Failed</th>
                    <th scope="col">Flagged</th>
                  </tr>
                </thead>
                <tbody>
                  {calibration.map((bucket) => (
                    <tr key={bucket.from}>
                      <th scope="row">{wholePercent(bucket.from)}–{wholePercent(bucket.to)}</th>
                      <td>{bucket.decisions}</td>
                      <td>{bucket.followUpCalls}</td>
                      <td>{percent(bucket.followUpFailed, bucket.followUpCalls)}</td>
                      <td>{percent(bucket.followUpFlagged, bucket.followUpScored)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div>
            <Button variant="ghost" onClick={() => jevDecisionStats.clear()}>Clear results</Button>
          </div>
        </div>
      ) : (
        <p className={styles.fieldHint}>No decisions made yet.</p>
      )}
    </section>
  );
};
