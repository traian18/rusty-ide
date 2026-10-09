import React from "react";
import { CircleAlert, Layers } from "lucide-react";
import { useWorkspaceStore } from "../../store";
import { findOpenRouterJevProvider } from "../../services/intelligentModelSelector";
import styles from "./IntelligentModelSelectionSettings.module.css";

export const JevContextCompactionSettings: React.FC = () => {
  const settings = useWorkspaceStore((state) => state.intelligentModelSelectionSettings);
  const updateSettings = useWorkspaceStore((state) => state.updateIntelligentModelSelectionSettings);
  const providers = useWorkspaceStore((state) => state.customProviders);
  const hasJev = Boolean(findOpenRouterJevProvider(providers, settings.jevModelId));
  const smart = settings.smartContextCompactionEnabled && hasJev;

  return (
    <section className={styles.section} aria-labelledby="jev-context-compaction-title">
      <div className={styles.heading}>
        <div className={styles.headingCopy}>
          <div className={styles.titleRow}>
            <Layers aria-hidden="true" size={16} />
            <h3 className={styles.title} id="jev-context-compaction-title">Smart context compaction (experimental)</h3>
          </div>
          <p className={styles.description}>
            Two things grow during a chat: its earlier messages, and the tool output within each run. By default Rusty shrinks both locally, without a model call: once earlier messages take about 40% of the model's window the oldest are left out, and within a run old tool output is trimmed before the oldest steps are dropped. The opening request and any message you pin (the pin beside each message) always stay word for word. Turn this on to let JEV decide instead: it rates which older messages and steps still matter, essential ones stay word for word, disposable ones are dropped, and your chat's model summarizes the rest in the background, so no request waits for it. Each rated batch is one Decisions API request, and each summary is one extra call on your chat's provider, shown in Token Metrics. If JEV or a summary is unavailable, the default takes over. Applies from the next run.
          </p>
        </div>
        <label className={styles.toggleLabel} htmlFor="jev-context-compaction-enabled">
          <input
            className={styles.toggleInput}
            id="jev-context-compaction-enabled"
            type="checkbox"
            checked={smart}
            disabled={!hasJev}
            onChange={(event) => updateSettings({ smartContextCompactionEnabled: event.target.checked })}
          />
          <span className={styles.toggleTrack} aria-hidden="true"><span /></span>
          <span>Enabled</span>
        </label>
      </div>

      {!hasJev && (
        <div className={styles.statusWarning} role="status">
          <CircleAlert aria-hidden="true" size={14} />
          <span>Connect OpenRouter and choose a JEV decision model under Intelligent model selection first. Until then the default compaction is used.</span>
        </div>
      )}

      <p className={styles.fieldHint}>Active: {smart ? "Smart (JEV-assisted summary)" : "Default (local trimming)"}.</p>
    </section>
  );
};
