import type { ExecutionTokensSnapshot, ModelUsageEntry, RunUsage } from "../../../observability/types";
import styles from "../ToolExecutionPanel.module.css";
import { USAGE_COLUMNS, sumUsage } from "./groupedRun";

const TOKEN_FIELDS: { key: keyof ExecutionTokensSnapshot; label: string }[] = [
  { key: "inputTokens", label: "Input (Prompt)" },
  { key: "outputTokens", label: "Output (Completion)" },
  { key: "cacheReadTokens", label: "Cache Read" },
  { key: "cacheWriteTokens", label: "Cache Write" },
  { key: "reasoningTokens", label: "Reasoning" },
];

/** Fields a run recorded before per-model tracking reports, when it reports any. */
const LEGACY_TOTAL_FIELDS: (keyof ExecutionTokensSnapshot)[] = ["totalTokens", "inputTokens", "outputTokens"];

export function TokenGrid({ tokens }: { tokens: ExecutionTokensSnapshot }) {
  return (
    <div className={styles.tokenGrid}>
      <div className={`${styles.tokenCard} ${styles.tokenCardHighlight}`}>
        <span className={styles.tokenLabel}>Total Tokens</span>
        <strong className={styles.tokenValue}>{tokens.totalTokens?.toLocaleString() ?? "—"}</strong>
      </div>
      {TOKEN_FIELDS.map(({ key, label }) => tokens[key] !== undefined && (
        <div key={key} className={styles.tokenCard}>
          <span className={styles.tokenLabel}>{label}</span>
          <span className={styles.tokenValue}>{tokens[key]!.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

function roleLabel(entry: ModelUsageEntry): string {
  if (entry.role === "run") return "Run model";
  if (entry.role === "subagent") return "Subagent model";
  return entry.purpose ?? "Tool model";
}

/** The run's own model(s) first, then the most tokens first. */
function byRoleThenTokens(a: ModelUsageEntry, b: ModelUsageEntry): number {
  const roleOrder = a.role === b.role ? 0 : a.role === "run" ? -1 : 1;
  return roleOrder || (b.tokens.totalTokens ?? 0) - (a.tokens.totalTokens ?? 0);
}

const cell = (value: number | undefined) => (value === undefined ? "—" : value.toLocaleString());

function LegacyRunTokens({ tokens }: { tokens?: ExecutionTokensSnapshot }) {
  const reported = LEGACY_TOTAL_FIELDS.some((key) => tokens?.[key] !== undefined);
  return (
    <section className={styles.detailSection}>
      <h4>Run Token Usage <small>(Model Total)</small></h4>
      {reported ? <TokenGrid tokens={tokens!} /> : <p className={styles.tokenEmpty}>Token count not reported for this run</p>}
    </section>
  );
}

/** Token usage for the whole run, one row per model: the run's own model(s)
 * and any model a tool delegated work to, so the total can be traced. Runs
 * recorded before per-model tracking fall back to the single total. */
export function RunTokenUsage({ usage, tokens }: { usage?: RunUsage; tokens?: ExecutionTokensSnapshot }) {
  const entries = Object.values(usage ?? {}).sort(byRoleThenTokens);
  if (entries.length === 0) return <LegacyRunTokens tokens={tokens} />;
  const columns = USAGE_COLUMNS.filter(({ key }) => entries.some((entry) => entry.tokens[key] !== undefined));
  return (
    <section className={styles.detailSection} aria-label="Run token usage by model">
      <h4>Run Token Usage <small>by model</small></h4>
      <div className={styles.usageTableWrap}>
        <table className={styles.usageTable}>
          <thead>
            <tr>
              <th scope="col">Model</th>
              {columns.map(({ key, label }) => <th key={key} scope="col">{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={`${entry.role}:${entry.model}`}>
                <th scope="row">
                  <span className={styles.usageModel} title={entry.model}>{entry.model}</span>
                  <small>{roleLabel(entry)}{entry.provider ? ` · ${entry.provider}` : ""}</small>
                </th>
                {columns.map(({ key }) => <td key={key}>{cell(entry.tokens[key])}</td>)}
              </tr>
            ))}
          </tbody>
          {entries.length > 1 && (
            <tfoot>
              <tr>
                <th scope="row">All models</th>
                {columns.map(({ key }) => <td key={key}>{cell(sumUsage(entries)[key])}</td>)}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}
