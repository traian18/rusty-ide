import React from "react";
import { CircleAlert, Layers } from "lucide-react";
import { useWorkspaceStore } from "../../../store";
import { findOpenRouterJevProvider } from "../../providers";
import styles from "../../../lib/ui/ModelSelectionSettings.module.css";

export const JevContextCompactionSettings: React.FC = () => {
  const settings = useWorkspaceStore((state) => state.intelligentModelSelectionSettings);
  const updateSettings = useWorkspaceStore((state) => state.updateIntelligentModelSelectionSettings);
  const providers = useWorkspaceStore((state) => state.customProviders);
  const hasJev = Boolean(findOpenRouterJevProvider(providers, settings.jevModelId));
  const summaries = settings.contextSummariesEnabled;
  const smart = summaries && settings.smartContextCompactionEnabled && hasJev;

  return (
    <section className={styles.section} aria-labelledby="context-compaction-title">
      <div className={styles.heading}>
        <div className={styles.headingCopy}>
          <div className={styles.titleRow}>
            <Layers aria-hidden="true" size={16} />
            <h3 className={styles.title} id="context-compaction-title">Summarize long conversations</h3>
          </div>
          <p className={styles.description}>
            Two things grow during a chat: its earlier messages, and the tool output within each run. Rusty first shrinks both locally, without a model call: old tool output is trimmed, and once earlier messages take about 40% of the model's window the oldest are left out. With this on, your chat's model also writes a running summary of what aged out, in the background, so no request waits for it. Each summary is one extra call on your chat's provider, shown in Token Metrics. The opening request and any message you pin always stay word for word. If a summary fails, local trimming keeps the request in budget. Applies from the next run.
          </p>
        </div>
        <label className={styles.toggleLabel} htmlFor="context-summaries-enabled">
          <input
            className={styles.toggleInput}
            id="context-summaries-enabled"
            type="checkbox"
            checked={summaries}
            onChange={(event) => updateSettings({ contextSummariesEnabled: event.target.checked })}
          />
          <span className={styles.toggleTrack} aria-hidden="true"><span /></span>
          <span>Enabled</span>
        </label>
      </div>

      <div className={styles.heading}>
        <div className={styles.headingCopy}>
          <h4 className={styles.title} id="jev-context-compaction-title">Rate messages with JEV first (experimental)</h4>
          <p className={styles.description}>
            Before a summary, JEV rates which older messages and steps still matter: essential ones stay word for word, disposable ones are dropped, and only the rest is summarized. Each rated batch is one Decisions API request. Without JEV, everything that aged out is summarized.
          </p>
        </div>
        <label className={styles.toggleLabel} htmlFor="jev-context-compaction-enabled">
          <input
            className={styles.toggleInput}
            id="jev-context-compaction-enabled"
            type="checkbox"
            checked={smart}
            disabled={!hasJev || !summaries}
            onChange={(event) => updateSettings({ smartContextCompactionEnabled: event.target.checked })}
          />
          <span className={styles.toggleTrack} aria-hidden="true"><span /></span>
          <span>Enabled</span>
        </label>
      </div>

      {!hasJev && summaries && (
        <div className={styles.statusWarning} role="status">
          <CircleAlert aria-hidden="true" size={14} />
          <span>For JEV ratings, connect OpenRouter and choose a JEV decision model under Intelligent model selection. Summaries work without it.</span>
        </div>
      )}

      <p className={styles.fieldHint}>Active: {!summaries ? "Local trimming only" : smart ? "Summaries, with JEV ratings" : "Summaries"}.</p>
    </section>
  );
};
