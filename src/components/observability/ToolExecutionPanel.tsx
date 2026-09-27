import { RunExecutionTimeline, estimateTokens, type TimelineItem } from "./RunExecutionTimeline";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bot,
  Brain,
  Copy,
  Database,
  FileCode2,
  Info,
  Trash2,
  X,
} from "lucide-react";
import { describeCallModels, extractCallSummary, formatToolExecutor } from "./callSummary";
import { executionObservability } from "../../observability/executionStore";
import { useTrajectories, type RunTrajectory, type TrajectoryEntry } from "../../observability/trajectoryStore";
import type { ExecutionTokensSnapshot, ModelUsageEntry, RunUsage, ToolExecutionDetail, ToolExecutionRecord, ToolExecutionStatus } from "../../observability/types";
import { useExecutionObservability } from "../../observability/useExecutionObservability";
import { useWorkspaceStore, type UsageTotals } from "../../store";
import { usageMetricsService } from "../../services/usageMetricsService";
import { CustomSelect } from "../CustomSelect";
import styles from "./ToolExecutionPanel.module.css";

export interface TimelineToolItem {
  kind: "tool";
  id: string;
  timestamp: string;
  record: ToolExecutionRecord;
}

export interface TimelineAssistantTextItem {
  kind: "assistant_text";
  id: string;
  timestamp: string;
  messageId: string;
  text: string;
  agentId?: string;
}

export interface TimelineReasoningItem {
  kind: "reasoning";
  id: string;
  timestamp: string;
  messageId: string;
  text: string;
  agentId?: string;
}

interface GroupedRun {
  runId: string;
  sessionId?: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  originLabel: string;
  surface: string;
  capability?: string;
  model?: string;
  provider?: string;
  requestPrompt?: string;
  totalTokens?: number;
  runTokens?: ExecutionTokensSnapshot;
  usage?: RunUsage;
  records: ToolExecutionRecord[];
  timelineItems: TimelineItem[];
  entries: TrajectoryEntry[];
}

const STATUS_LABEL: Record<ToolExecutionStatus, string> = {
  queued: "Queued",
  "waiting-permission": "Needs permission",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
};

const RETENTION_OPTIONS = [
  { id: "7", name: "7 days" },
  { id: "30", name: "30 days" },
  { id: "90", name: "90 days" },
  { id: "unlimited", name: "All" },
];

function formatTokens(value: number): string {
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${(value / 1_000).toFixed(1)}k` : String(Math.round(value));
}

function describeTotals(totals: UsageTotals): string {
  const parts = [`${formatTokens(totals.input)} in`, `${formatTokens(totals.output)} out`];
  if (totals.cacheRead) parts.push(`${formatTokens(totals.cacheRead)} cache read`);
  if (totals.cacheWrite) parts.push(`${formatTokens(totals.cacheWrite)} cache write`);
  if (totals.reasoning) parts.push(`${formatTokens(totals.reasoning)} reasoning`);
  return `${parts.join(" · ")} · ${totals.calls.toLocaleString()} calls`;
}

function AllTimeUsage({ refreshKey }: { refreshKey: number }) {
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const rusty = useWorkspaceStore((state) => state.metricsSummary?.allTime.total);
  const loadMetricsSummary = useWorkspaceStore((state) => state.loadMetricsSummary);
  const [claudeCode, setClaudeCode] = useState<UsageTotals | null>(null);

  useEffect(() => {
    void loadMetricsSummary();
    if (!rootPath) return;
    let cancelled = false;
    void usageMetricsService.loadClaudeCodeTotals(rootPath).then((totals) => { if (!cancelled) setClaudeCode(totals); });
    return () => { cancelled = true; };
  }, [rootPath, loadMetricsSummary, refreshKey]);

  if (!rusty && !claudeCode) return null;
  return (
    <div className={styles.usageTotals} aria-label="All-time token usage">
      <strong>All-time tokens</strong>
      {rusty && <span title={describeTotals(rusty)}>Rusty agents: {formatTokens(rusty.totalTokens)} · {describeTotals(rusty)}</span>}
      {claudeCode && <span title={describeTotals(claudeCode)}>Claude Code: {formatTokens(claudeCode.totalTokens)} · {describeTotals(claudeCode)}</span>}
    </div>
  );
}

function formatDuration(record: ToolExecutionRecord): string {
  if (record.durationMs === undefined) return record.status === "running" ? "Live" : "—";
  if (record.durationMs < 1_000) return `${record.durationMs} ms`;
  return `${(record.durationMs / 1_000).toFixed(record.durationMs < 10_000 ? 1 : 0)} s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function getTimestampMs(isoString?: string): number {
  if (!isoString) return 0;
  const parsed = Date.parse(isoString);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatDateTime(isoString?: string): string {
  if (!isoString) return "—";
  const date = new Date(isoString);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function formatTime(isoString?: string): string {
  if (!isoString) return "—";
  const date = new Date(isoString);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString();
}

function JsonValue({ value }: { value: unknown }) {
  return <pre className={styles.code}>{JSON.stringify(value, null, 2) ?? "—"}</pre>;
}

const TOKEN_FIELDS: { key: keyof ExecutionTokensSnapshot; label: string }[] = [
  { key: "inputTokens", label: "Input (Prompt)" },
  { key: "outputTokens", label: "Output (Completion)" },
  { key: "cacheReadTokens", label: "Cache Read" },
  { key: "cacheWriteTokens", label: "Cache Write" },
  { key: "reasoningTokens", label: "Reasoning" },
];

function TokenGrid({ tokens }: { tokens: ExecutionTokensSnapshot }) {
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

const USAGE_COLUMNS: { key: keyof ExecutionTokensSnapshot; label: string }[] = [
  { key: "inputTokens", label: "Input" },
  { key: "outputTokens", label: "Output" },
  { key: "cacheReadTokens", label: "Cache read" },
  { key: "cacheWriteTokens", label: "Cache write" },
  { key: "reasoningTokens", label: "Reasoning" },
  { key: "totalTokens", label: "Total" },
];

function sumUsage(entries: ModelUsageEntry[]): ExecutionTokensSnapshot {
  const total: ExecutionTokensSnapshot = {};
  for (const entry of entries) {
    for (const { key } of USAGE_COLUMNS) {
      const value = entry.tokens[key];
      if (value !== undefined) total[key] = (total[key] ?? 0) + value;
    }
  }
  return total;
}

/** Every model's tokens in the run, including models tools delegated to. */
export function runUsageTotal(usage: RunUsage | undefined): ExecutionTokensSnapshot | undefined {
  const entries = Object.values(usage ?? {});
  return entries.length ? sumUsage(entries) : undefined;
}

/** Token usage for the whole run, one row per model: the run's own model(s)
 * and any model a tool delegated work to, so the total can be traced. Runs
 * recorded before per-model tracking fall back to the single total. */
function RunTokenUsage({ usage, tokens }: { usage?: RunUsage; tokens?: ExecutionTokensSnapshot }) {
  const entries = Object.values(usage ?? {}).sort((a, b) =>
    (a.role === b.role ? 0 : a.role === "run" ? -1 : 1) || (b.tokens.totalTokens ?? 0) - (a.tokens.totalTokens ?? 0));
  if (entries.length === 0) {
    const legacy = tokens && (tokens.totalTokens !== undefined || tokens.inputTokens !== undefined || tokens.outputTokens !== undefined);
    return (
      <section className={styles.detailSection}>
        <h4>Run Token Usage <small>(Model Total)</small></h4>
        {legacy ? <TokenGrid tokens={tokens!} /> : <p className={styles.tokenEmpty}>Token count not reported for this run</p>}
      </section>
    );
  }
  const columns = USAGE_COLUMNS.filter(({ key }) => entries.some((entry) => entry.tokens[key] !== undefined));
  const cell = (value: number | undefined) => (value === undefined ? "—" : value.toLocaleString());
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
                  <small>{entry.role === "run" ? "Run model" : entry.role === "subagent" ? "Subagent model" : entry.purpose ?? "Tool model"}{entry.provider ? ` · ${entry.provider}` : ""}</small>
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

/** What the tool itself reported through its ToolExecutionObserver. */
function ToolExecutionSection({ execution }: { execution: ToolExecutionDetail }) {
  const { executor, tokens, steps } = execution;
  return (
    <section className={styles.detailSection} aria-label="Tool execution">
      <h4>Tool Execution {executor && <small>{executor.purpose}</small>}</h4>
      {executor && (
        <dl className={styles.metadata}>
          {executor.model && <div><dt>Executed by model</dt><dd title={executor.model}>{executor.model}</dd></div>}
          {executor.provider && <div><dt>{executor.kind === "service" ? "Executed by service" : "Provider"}</dt><dd title={executor.provider}>{executor.provider}</dd></div>}
        </dl>
      )}
      {tokens && <TokenGrid tokens={tokens} />}
      {steps.length > 0 && (
        <ol className={styles.executionSteps}>
          {steps.map((step, index) => (
            <li key={`${step.at}-${index}`} className={step.level === "info" ? undefined : styles[`executionStep_${step.level}`]}>
              <span className={styles.executionStepTime}>{formatTime(step.at)}</span>
              {step.details === undefined ? (
                <span>{step.message}</span>
              ) : (
                <details>
                  <summary>{step.message}</summary>
                  <JsonValue value={step.details} />
                </details>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ExecutionDetail({ record, runTokens, runUsage }: { record: ToolExecutionRecord; runTokens?: ExecutionTokensSnapshot; runUsage?: RunUsage }) {
  const active = ["queued", "waiting-permission", "running"].includes(record.status);
  const sourceTabId = record.origin.tabId ?? record.origin.canvasId;
  const canOpenSource = useWorkspaceStore((state) => Boolean(sourceTabId && state.tabs.some((tab) => tab.id === sourceTabId)));
  const activateTab = useWorkspaceStore((state) => state.activateTab);
  const setSelectedNodeId = useWorkspaceStore((state) => state.setSelectedNodeId);
  const callSummary = extractCallSummary(record);
  const executor = record.execution?.executor;
  const models = describeCallModels(record);

  const tokens = runTokens ?? record.tokens;

  return (
    <div className={styles.detail}>
      {/* What the call is: Prominent Action Banner */}
      <div className={styles.callBanner}>
        <div className={styles.callBannerTop}>
          <span className={styles.callBannerBadge}>
            <FileCode2 size={15} className="text-[var(--color-primary)]" />
            {record.toolName}
          </span>
          <span className={styles.callParamPill} title={`Executed by ${models.executedBy}`}>
            <strong>Executed by:</strong>
            <span>{executor ? formatToolExecutor(executor) : models.executedBy}</span>
          </span>
          <span className={styles.callParamPill} title={`Requested by ${models.requestedBy}`}>
            <strong>Requested by:</strong>
            <span>{models.requestedBy}</span>
          </span>
          {record.status === "running" && (
            <span className={`${styles.status} ${styles.status_running}`} />
          )}
        </div>
        <div className={styles.callHeadline}>{callSummary.actionLabel}</div>
        {callSummary.summary && (
          <p className="text-[var(--color-fg-default)] text-xs font-sans m-0 font-medium">{callSummary.summary}</p>
        )}
        {callSummary.description && (
          <p className="text-[var(--color-fg-default)] text-xs font-sans m-0">{callSummary.description}</p>
        )}
        {callSummary.instruction && (
          <p className="text-[var(--color-fg-muted)] text-xs font-mono m-0 italic">{callSummary.instruction}</p>
        )}
        {callSummary.keyParams.length > 0 && (
          <div className={styles.callKeyParams}>
            {callSummary.keyParams.map((p: { label: string; value: string }) => (
              <span key={p.label} className={styles.callParamPill}>
                <strong>{p.label}:</strong>
                <span>{p.value}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Call Arguments */}
      <section className={styles.detailSection}>
        <div className={styles.sectionHeaderWithAction}>
          <h4>Call Arguments <small>{record.payloadState}</small></h4>
          <button
            type="button"
            className={styles.copySmallButton}
            onClick={() => navigator.clipboard?.writeText(JSON.stringify(record.arguments, null, 2))}
            title="Copy call arguments"
          >
            <Copy size={11} /> Copy arguments
          </button>
        </div>
        <JsonValue value={record.arguments} />
      </section>

      {/* Call Output */}
      {record.resultPreview !== undefined && (
        <section className={styles.detailSection}>
          <div className={styles.sectionHeaderWithAction}>
            <h4>Call Output</h4>
            <button
              type="button"
              className={styles.copySmallButton}
              onClick={() => navigator.clipboard?.writeText(String(record.resultPreview))}
              title="Copy output"
            >
              <Copy size={11} /> Copy result
            </button>
          </div>
          <JsonValue value={record.resultPreview} />
        </section>
      )}

      {record.execution && <ToolExecutionSection execution={record.execution} />}

      {/* Run Request Context (Initiating Prompt) */}
      {(record.context.requestPrompt || record.context.selection) && (
        <section className={styles.detailSection}>
          <div className={styles.sectionHeaderWithAction}>
            <div>
              <h4>Run Context (Initiating Prompt)</h4>
              <small className="text-[var(--color-fg-muted)] text-[10px]">User request initiating this run</small>
            </div>
            {record.context.requestPrompt && (
              <button
                type="button"
                className={styles.copySmallButton}
                onClick={() => navigator.clipboard?.writeText(record.context.requestPrompt!)}
                title="Copy request prompt"
              >
                <Copy size={11} /> Copy prompt
              </button>
            )}
          </div>
          <div className={styles.contextNotice}>
            <Info size={13} className="text-[var(--color-primary)] shrink-0" />
            <span>
              All tool calls within this run share the same initiating user request. What this specific call does is shown in the Call Action banner above.
            </span>
          </div>
          {record.context.requestPrompt && (
            <div className={styles.promptCard}>{record.context.requestPrompt}</div>
          )}
          {record.context.selection && (
            <div className={styles.selectionInfo}>
              <span className={styles.selectionLabel}>Target file selection:</span>
              <code className={styles.selectionCode}>
                {record.context.selection.filePath}{record.context.selection.lineRange ? `:${record.context.selection.lineRange}` : ""}
              </code>
              {record.context.selection.textPreview && (
                <pre className={styles.code}>{record.context.selection.textPreview}</pre>
              )}
            </div>
          )}
        </section>
      )}

      <RunTokenUsage usage={runUsage} tokens={tokens} />

      {record.progress && (
        <section className={styles.detailSection}>
          <h4>Progress</h4>
          <div className={styles.progress}><span style={{ width: `${Math.max(0, Math.min(1, record.progress.fraction)) * 100}%` }} /></div>
          <p>{record.progress.status} · {Math.round(record.progress.fraction * 100)}%</p>
        </section>
      )}

      <section className={styles.detailSection}>
        <h4>Call Metadata</h4>
        <dl className={styles.metadata}>
          <div><dt>Source</dt><dd>{record.origin.displayLabel}</dd></div>
          <div><dt>Surface</dt><dd>{record.origin.surface}</dd></div>
          {record.origin.canvasId && <div><dt>Canvas</dt><dd>{record.origin.canvasId}</dd></div>}
          {record.origin.nodeId && <div><dt>Node</dt><dd>{record.origin.nodeId}</dd></div>}
          <div><dt>Capability</dt><dd>{record.context.capability}</dd></div>
          <div><dt>Executed by</dt><dd title={models.executedBy}>{models.executedBy}</dd></div>
          <div><dt>Requested by model</dt><dd title={models.requestedBy}>{models.requestedBy}</dd></div>
          {(record.requestedBy?.provider ?? record.context.provider) && <div><dt>Requesting provider</dt><dd>{record.requestedBy?.provider ?? record.context.provider}</dd></div>}
          <div><dt>Session</dt><dd>{record.sessionId ?? "—"}</dd></div>
          <div><dt>Agent</dt><dd>{record.agentId ?? "—"}</dd></div>
          {record.parentAgentId && <div><dt>Parent agent</dt><dd>{record.parentAgentId}</dd></div>}
          <div><dt>Call ID</dt><dd>{record.callId}</dd></div>
          <div><dt>Requested</dt><dd>{formatDateTime(record.requestedAt)}</dd></div>
          {record.startedAt && <div><dt>Started</dt><dd>{formatDateTime(record.startedAt)}</dd></div>}
          {record.finishedAt && <div><dt>Finished</dt><dd>{formatDateTime(record.finishedAt)}</dd></div>}
          {record.permission && <div><dt>Permission</dt><dd>{record.permission.state}</dd></div>}
        </dl>
      </section>

      <div className={styles.rowActions}>
        {canOpenSource && <button type="button" onClick={() => {
          activateTab(sourceTabId!);
          if (record.origin.nodeId) setSelectedNodeId(record.origin.nodeId);
        }}>Open source</button>}
        <button type="button" onClick={() => navigator.clipboard?.writeText(JSON.stringify(record, null, 2))}>Copy redacted record</button>
        <button type="button" disabled={active} title={active ? "Active executions cannot be deleted" : undefined} onClick={() => executionObservability.deleteExecution(record.id)}><Trash2 size={13} /> Delete</button>
        {record.sessionId && <button type="button" disabled={active} onClick={() => executionObservability.deleteSession(record.sessionId!)}>Delete session</button>}
        {record.origin.workspaceId && <button type="button" disabled={active} onClick={() => executionObservability.deleteWorkspace(record.origin.workspaceId!)}>Delete workspace history</button>}
      </div>
    </div>
  );
}

function AssistantTextDetail({
  item,
  requestPrompt,
  tokens,
  usage,
  model,
  originLabel,
  surface,
}: {
  item: TimelineAssistantTextItem;
  requestPrompt?: string;
  tokens?: ExecutionTokensSnapshot;
  usage?: RunUsage;
  model?: string;
  originLabel: string;
  surface: string;
}) {
  const wordCount = item.text.trim().split(/\s+/).filter(Boolean).length;
  const charCount = item.text.length;

  return (
    <div className={styles.detail}>
      {/* Assistant Response Banner */}
      <div className={styles.callBanner}>
        <div className={styles.callBannerTop}>
          <span className={styles.callBannerBadge}>
            <Bot size={15} className="text-[var(--color-primary)]" />
            Assistant Response
          </span>
          <span className="text-[var(--color-fg-muted)] font-mono text-xs">
            {formatTime(item.timestamp)}
          </span>
        </div>
        <div className={styles.callHeadline}>Model Output Message</div>
        <div className={styles.callKeyParams}>
          <span className={styles.callParamPill}>
            <strong>Words:</strong>
            <span>{wordCount}</span>
          </span>
          <span className={styles.callParamPill}>
            <strong>Chars:</strong>
            <span>{charCount}</span>
          </span>
          {item.messageId && (
            <span className={styles.callParamPill}>
              <strong>Message ID:</strong>
              <span>{item.messageId}</span>
            </span>
          )}
          {item.agentId && (
            <span className={styles.callParamPill}>
              <strong>Agent:</strong>
              <span>{item.agentId}</span>
            </span>
          )}
        </div>
      </div>

      {/* Response Content */}
      <section className={styles.detailSection}>
        <div className={styles.sectionHeaderWithAction}>
          <h4>Response Content</h4>
          <button
            type="button"
            className={styles.copySmallButton}
            onClick={() => navigator.clipboard?.writeText(item.text)}
            title="Copy assistant response text"
          >
            <Copy size={11} /> Copy text
          </button>
        </div>
        <div className={styles.promptCard}>{item.text}</div>
      </section>

      {/* Run Request Context (Initiating Prompt) */}
      {requestPrompt && (
        <section className={styles.detailSection}>
          <div className={styles.sectionHeaderWithAction}>
            <div>
              <h4>Run Context (Initiating Prompt)</h4>
              <small className="text-[var(--color-fg-muted)] text-[10px]">User request initiating this run</small>
            </div>
            <button
              type="button"
              className={styles.copySmallButton}
              onClick={() => navigator.clipboard?.writeText(requestPrompt)}
              title="Copy request prompt"
            >
              <Copy size={11} /> Copy prompt
            </button>
          </div>
          <div className={styles.contextNotice}>
            <Info size={13} className="text-[var(--color-primary)] shrink-0" />
            <span>
              All responses and tool calls in this run stem from the user prompt below.
            </span>
          </div>
          <div className={styles.promptCard}>{requestPrompt}</div>
        </section>
      )}

      <RunTokenUsage usage={usage} tokens={tokens} />

      {/* Metadata */}
      <section className={styles.detailSection}>
        <h4>Execution Metadata</h4>
        <dl className={styles.metadata}>
          <div><dt>Source</dt><dd>{originLabel}</dd></div>
          <div><dt>Surface</dt><dd>{surface}</dd></div>
          {model && <div><dt>Model</dt><dd>{model}</dd></div>}
          <div><dt>Timestamp</dt><dd>{formatDateTime(item.timestamp)}</dd></div>
        </dl>
      </section>
    </div>
  );
}

function ReasoningDetail({
  item,
  requestPrompt,
  tokens,
  usage,
  model,
  originLabel,
  surface,
}: {
  item: TimelineReasoningItem;
  requestPrompt?: string;
  tokens?: ExecutionTokensSnapshot;
  usage?: RunUsage;
  model?: string;
  originLabel: string;
  surface: string;
}) {
  const tokenEstimate = estimateTokens(item.text);
  const charCount = item.text.length;

  return (
    <div className={styles.detail}>
      {/* Reasoning Banner */}
      <div className={styles.callBanner}>
        <div className={styles.callBannerTop}>
          <span className={styles.callBannerBadge}>
            <Brain size={15} className="text-[var(--color-primary)]" />
            Reasoning
          </span>
          <span className="text-[var(--color-fg-muted)] font-mono text-xs">
            {formatTime(item.timestamp)}
          </span>
        </div>
        <div className={styles.callHeadline}>Model Reasoning (Internal)</div>
        <div className={styles.callKeyParams}>
          <span className={styles.callParamPill}>
            <strong>Est. tokens:</strong>
            <span>~{tokenEstimate}</span>
          </span>
          <span className={styles.callParamPill}>
            <strong>Chars:</strong>
            <span>{charCount}</span>
          </span>
          {item.messageId && (
            <span className={styles.callParamPill}>
              <strong>Message ID:</strong>
              <span>{item.messageId}</span>
            </span>
          )}
          {item.agentId && (
            <span className={styles.callParamPill}>
              <strong>Agent:</strong>
              <span>{item.agentId}</span>
            </span>
          )}
        </div>
      </div>

      {/* Response Content */}
      <section className={styles.detailSection}>
        <div className={styles.sectionHeaderWithAction}>
          <h4>Reasoning Content</h4>
          <button
            type="button"
            className={styles.copySmallButton}
            onClick={() => navigator.clipboard?.writeText(item.text)}
            title="Copy reasoning text"
          >
            <Copy size={11} /> Copy text
          </button>
        </div>
        <div className={styles.promptCard}>{item.text}</div>
      </section>

      {/* Run Request Context (Initiating Prompt) */}
      {requestPrompt && (
        <section className={styles.detailSection}>
          <div className={styles.sectionHeaderWithAction}>
            <div>
              <h4>Run Context (Initiating Prompt)</h4>
              <small className="text-[var(--color-fg-muted)] text-[10px]">User request initiating this run</small>
            </div>
            <button
              type="button"
              className={styles.copySmallButton}
              onClick={() => navigator.clipboard?.writeText(requestPrompt)}
              title="Copy request prompt"
            >
              <Copy size={11} /> Copy prompt
            </button>
          </div>
          <div className={styles.contextNotice}>
            <Info size={13} className="text-[var(--color-primary)] shrink-0" />
            <span>
              All responses and tool calls in this run stem from the user prompt below.
            </span>
          </div>
          <div className={styles.promptCard}>{requestPrompt}</div>
        </section>
      )}

      <RunTokenUsage usage={usage} tokens={tokens} />

      {/* Metadata */}
      <section className={styles.detailSection}>
        <h4>Execution Metadata</h4>
        <dl className={styles.metadata}>
          <div><dt>Source</dt><dd>{originLabel}</dd></div>
          <div><dt>Surface</dt><dd>{surface}</dd></div>
          {model && <div><dt>Model</dt><dd>{model}</dd></div>}
          <div><dt>Timestamp</dt><dd>{formatDateTime(item.timestamp)}</dd></div>
        </dl>
      </section>
    </div>
  );
}

/** Re-renders only when its own run, selection, or active state changes, so
 * a streaming session doesn't re-render every other run on each update. */
const RunCard = memo(function RunCard({
  run,
  active,
  selectedItemId,
  onSelectItem,
}: {
  run: GroupedRun;
  active: boolean;
  selectedItemId: string | null;
  onSelectItem: (id: string) => void;
}) {
  return (
    <article className={`${styles.runCard} ${active ? styles.runCardActive : ""}`}>
      <div className={styles.runCardHeader}>
        <div className={styles.runIdentity}>
          {run.status === "running" && (
            <span className={`${styles.runStatusBadge} ${styles.runStatus_running}`}>
              Running
            </span>
          )}
          {run.status === "cancelled" && (
            <span className={`${styles.runStatusBadge} ${styles.runStatus_cancelled}`}>
              Cancelled
            </span>
          )}
          <strong className={styles.runPromptPreview} title={run.requestPrompt || run.originLabel}>
            {run.requestPrompt ? `"${run.requestPrompt}"` : run.originLabel}
          </strong>
          {run.capability && <span className={styles.runMetaPill}>{run.capability}</span>}
          {run.model && <span className={styles.runMetaPill}>{run.model}</span>}
          <span className={styles.runMetaPill}>{run.surface}</span>
        </div>
        <div className={styles.runStats}>
          <span>{formatTime(run.startedAt)}</span>
          <span>{run.records.length} {run.records.length === 1 ? "call" : "calls"}</span>
          {run.durationMs !== undefined && <span>{(run.durationMs / 1000).toFixed(1)}s</span>}
          {run.totalTokens !== undefined && (
            <span title={Object.values(run.usage ?? {}).map((entry) => `${entry.model}${entry.role === "run" ? "" : ` (${entry.purpose ?? entry.role})`}: ${(entry.tokens.totalTokens ?? 0).toLocaleString()}`).join("\n") || undefined}>
              {run.totalTokens.toLocaleString()} tok
            </span>
          )}
        </div>
      </div>

      {/* Horizontal Time Series Execution Chart */}
      <RunExecutionTimeline
        items={run.timelineItems}
        selectedItemId={selectedItemId}
        onSelectItem={onSelectItem}
        runStartedAt={run.startedAt}
      />

      {/* Inline Collapsible Event Trace */}
      {run.entries.length > 0 && <RunTrace entries={run.entries} />}
    </article>
  );
});

/** The raw event trace: nothing is rendered until it is opened, and each
 * payload is formatted only when its own entry is expanded. */
function RunTrace({ entries }: { entries: TrajectoryEntry[] }) {
  const [open, setOpen] = useState(false);
  return (
    <details className={styles.runTraceDetails} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Event Trace ({entries.length} raw events)</summary>
      {open && (
        <div className={styles.runTraceList}>
          {entries.map((entry, index) => <TraceEntry key={entry.id} entry={entry} index={index} />)}
        </div>
      )}
    </details>
  );
}

function TraceEntry({ entry, index }: { entry: TrajectoryEntry; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <details className={styles.trajectoryEntry} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span>{entry.sequence ?? index + 1} · {entry.source}</span>
        <small>{formatTime(entry.timestamp)} · {entry.payloadState}</small>
      </summary>
      {open && (
        <div className={styles.detail}>
          {entry.agentId && <p className="text-xs text-[var(--color-fg-muted)] m-0">Agent: {entry.agentId}</p>}
          {(entry.eventCount ?? 0) > 1 && (
            <p className="text-xs text-[var(--color-fg-muted)] m-0">
              {entry.eventCount} streamed chunks grouped in order
            </p>
          )}
          <pre className={styles.code}>{JSON.stringify(entry.payload, null, 2)}</pre>
        </div>
      )}
    </details>
  );
}

/** Builds one run's view model. Pure, so the panel can cache it per run
 * and rebuild only runs whose trajectory or records actually changed. */
function buildGroupedRun(runId: string, traj: RunTrajectory | undefined, records: ToolExecutionRecord[]): GroupedRun {
  const sortedRecords = [...records].sort(
    (a, b) =>
      getTimestampMs(a.startedAt || a.requestedAt) -
      getTimestampMs(b.startedAt || b.requestedAt)
  );
  const trajFinished = traj && traj.status !== "running";
  const sanitizedRecords = sortedRecords.map((r) => {
    if (trajFinished && ["queued", "waiting-permission", "running"].includes(r.status)) {
      const resolvedStatus: ToolExecutionRecord["status"] = traj.status === "cancelled" ? "cancelled" : "failed";
      const finishedAtTime = traj.finishedAt || r.finishedAt || new Date().toISOString();
      return {
        ...r,
        status: resolvedStatus,
        finishedAt: finishedAtTime,
        durationMs: r.durationMs ?? (r.startedAt ? Math.max(0, getTimestampMs(finishedAtTime) - getTimestampMs(r.startedAt)) : undefined),
        resultPreview: r.resultPreview ?? "Process ended before a terminal tool event was recorded.",
      };
    }
    return r;
  });

  const firstRecord = sanitizedRecords[0];
  const lastRecord = sanitizedRecords[sanitizedRecords.length - 1];

  const startedAt = traj?.startedAt || firstRecord?.startedAt || firstRecord?.requestedAt || new Date().toISOString();
  const finishedAt = traj?.finishedAt || lastRecord?.finishedAt;
  const durationMs =
    startedAt && finishedAt
      ? Math.max(0, getTimestampMs(finishedAt) - getTimestampMs(startedAt))
      : undefined;

  const hasRunning =
    sanitizedRecords.some((r) =>
      ["queued", "waiting-permission", "running"].includes(r.status)
    ) || traj?.status === "running";
  const hasFailed =
    sanitizedRecords.some((r) => r.status === "failed") || traj?.status === "failed";
  const allCancelled =
    (sanitizedRecords.length > 0 && sanitizedRecords.every((r) => r.status === "cancelled")) ||
    traj?.status === "cancelled";

  const runStatus: GroupedRun["status"] = hasRunning
    ? "running"
    : hasFailed
    ? "failed"
    : allCancelled
    ? "cancelled"
    : "succeeded";

  // Per-model usage recorded on the run; runs recorded before per-model
  // tracking fall back to the largest token snapshot on their records.
  const runTokens = runUsageTotal(traj?.usage) ?? sanitizedRecords.reduce<ExecutionTokensSnapshot | undefined>((acc, r) => {
    if (!r.tokens?.totalTokens) return acc;
    if (!acc || (r.tokens.totalTokens > (acc.totalTokens ?? 0))) return r.tokens;
    return acc;
  }, undefined);

  const trajEntries = traj?.entries ?? [];

  // Extract AssistantTextDelta events from trajectory
  const textItems: TimelineAssistantTextItem[] = [];
  for (const entry of trajEntries) {
    if (entry.source === "AssistantTextDelta") {
      const p = entry.payload as Record<string, any> | undefined;
      const block = p?.AssistantTextDelta ?? p;
      const delta = typeof block?.delta === "string" ? block.delta : typeof block?.text === "string" ? block.text : "";
      if (delta.trim()) {
        textItems.push({
          kind: "assistant_text",
          id: `text-${entry.id}`,
          timestamp: entry.timestamp,
          messageId: String(block?.message_id ?? entry.id),
          text: delta,
          agentId: entry.agentId,
        });
      }
    }
  }

  // Extract ReasoningDelta events from trajectory -- same shape and
  // coalescing as AssistantTextDelta above (trajectoryStore.ts's
  // append() special-cases both sources identically).
  const reasoningItems: TimelineReasoningItem[] = [];
  for (const entry of trajEntries) {
    if (entry.source === "ReasoningDelta") {
      const p = entry.payload as Record<string, any> | undefined;
      const block = p?.ReasoningDelta ?? p;
      const delta = typeof block?.delta === "string" ? block.delta : typeof block?.text === "string" ? block.text : "";
      if (delta.trim()) {
        reasoningItems.push({
          kind: "reasoning",
          id: `reasoning-${entry.id}`,
          timestamp: entry.timestamp,
          messageId: String(block?.message_id ?? entry.id),
          text: delta,
          agentId: entry.agentId,
        });
      }
    }
  }

  const toolItems: TimelineToolItem[] = sanitizedRecords.map((record) => ({
    kind: "tool",
    id: record.id,
    timestamp: record.startedAt || record.requestedAt,
    record,
  }));

  const timelineItems: TimelineItem[] = [...toolItems, ...textItems, ...reasoningItems].sort(
    (a, b) => getTimestampMs(a.timestamp) - getTimestampMs(b.timestamp)
  );

  return {
    runId,
    sessionId: traj?.sessionId || firstRecord?.sessionId,
    status: runStatus,
    startedAt,
    finishedAt,
    durationMs,
    originLabel: traj?.origin?.displayLabel || firstRecord?.origin?.displayLabel || "Execution",
    surface: traj?.origin?.surface || firstRecord?.origin?.surface || "agent",
    capability: traj?.context?.capability || firstRecord?.context?.capability,
    model: traj?.context?.model || firstRecord?.context?.model,
    provider: traj?.context?.provider || firstRecord?.context?.provider,
    requestPrompt:
      traj?.context?.requestPrompt ||
      sanitizedRecords.find((r) => r.context?.requestPrompt)?.context?.requestPrompt,
    totalTokens: runTokens?.totalTokens,
    runTokens,
    usage: traj?.usage,
    records: sanitizedRecords,
    timelineItems,
    entries: trajEntries,
  };
}

function sameRecords(a: ToolExecutionRecord[], b: ToolExecutionRecord[]): boolean {
  return a.length === b.length && a.every((record, index) => record === b[index]);
}

export function ToolExecutionPanel({ onClose }: { onClose: () => void }) {
  const snapshot = useExecutionObservability();
  const trajectorySnapshot = useTrajectories();
  const [status, setStatus] = useState<"all" | ToolExecutionStatus>("all");
  const [surface, setSurface] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [onClose]);

  const surfaces = useMemo(
    () => [...new Set(snapshot.records.map((record) => record.origin.surface))],
    [snapshot.records]
  );
  const statusOptions = useMemo(
    () => [
      { id: "all", name: "All statuses" },
      ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ id: value, name: label })),
    ],
    []
  );
  const surfaceOptions = useMemo(
    () => [
      { id: "all", name: "All sources" },
      ...surfaces.map((value) => ({ id: value, name: value })),
    ],
    [surfaces]
  );

  // Runs are cached by identity: the stores create new objects only for what
  // changed, so while one session streams only that run is rebuilt.
  const runCache = useRef(new Map<string, { traj?: RunTrajectory; records: ToolExecutionRecord[]; run: GroupedRun }>());
  const groupedRuns = useMemo<GroupedRun[]>(() => {
    const runRecordsMap = new Map<string, ToolExecutionRecord[]>();
    for (const record of snapshot.records) {
      const key = record.ideRunId || (record.sessionId ? `legacy-${record.sessionId}` : `adhoc-${record.id}`);
      const group = runRecordsMap.get(key) ?? [];
      group.push(record);
      runRecordsMap.set(key, group);
    }
    // Strictly match trajectory by exact id (never by loose sessionId which conflates multiple runs)
    const trajectoriesById = new Map(trajectorySnapshot.runs.map((run) => [run.id, run]));
    const allRunIds = new Set<string>([...trajectoriesById.keys(), ...runRecordsMap.keys()]);

    const nextCache = new Map<string, { traj?: RunTrajectory; records: ToolExecutionRecord[]; run: GroupedRun }>();
    const runs: GroupedRun[] = [];
    for (const runId of allRunIds) {
      const traj = trajectoriesById.get(runId);
      const records = runRecordsMap.get(runId) ?? [];
      if (!traj && records.length === 0) continue;
      const cached = runCache.current.get(runId);
      const run = cached && cached.traj === traj && sameRecords(cached.records, records) ? cached.run : buildGroupedRun(runId, traj, records);
      nextCache.set(runId, { traj, records, run });
      runs.push(run);
    }
    runCache.current = nextCache;

    // Sort descending by startedAt: newest on top, scrolling towards older at bottom
    runs.sort((a, b) => getTimestampMs(b.startedAt) - getTimestampMs(a.startedAt));
    return runs;
  }, [snapshot.records, trajectorySnapshot.runs]);

  const filteredRuns = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return groupedRuns.filter((run) => {
      if (status !== "all") {
        if (run.status !== status && !run.records.some((r) => r.status === status)) {
          return false;
        }
      }
      if (surface !== "all" && run.surface !== surface) {
        return false;
      }
      if (!needle) return true;
      const promptMatch = run.requestPrompt?.toLowerCase().includes(needle);
      const modelMatch = run.model?.toLowerCase().includes(needle);
      const labelMatch = run.originLabel.toLowerCase().includes(needle);
      const capabilityMatch = run.capability?.toLowerCase().includes(needle);
      const recordsMatch = run.records.some((r) =>
        `${r.toolName} ${r.resultPreview ?? ""} ${JSON.stringify(r.arguments)}`.toLowerCase().includes(needle)
      );
      const textMatch = run.timelineItems.some((it) =>
        (it.kind === "assistant_text" || it.kind === "reasoning") && it.text.toLowerCase().includes(needle)
      );
      return promptMatch || modelMatch || labelMatch || capabilityMatch || recordsMatch || textMatch;
    });
  }, [groupedRuns, query, status, surface]);

  const selectedInfo = useMemo(() => {
    if (!selectedItemId) return null;
    for (const run of groupedRuns) {
      const item = run.timelineItems.find((it) => it.id === selectedItemId);
      if (item) return { run, item };
    }
    return null;
  }, [groupedRuns, selectedItemId]);

  const handleSelectItem = useCallback((itemId: string) => {
    setSelectedItemId((prev) => (prev === itemId ? null : itemId));
  }, []);

  return (
    <div
      className={styles.panelOverlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside id="tool-execution-panel" className={styles.panel} role="dialog" aria-modal="true" aria-label="Tool execution">
        <div className={styles.panelHeader}>
          <div>
            <h2>
              <Activity size={18} className="text-[var(--color-primary)]" />
              Tool Execution Observability
            </h2>
            <p>
              {snapshot.records.length} calls across {groupedRuns.length} executions · Timeline view per run
            </p>
          </div>
        <div className={styles.headerActions}>
          <button ref={closeRef} type="button" className={styles.iconButton} aria-label="Close tool execution" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </div>

      <div className={styles.filters}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search prompts, tools, responses, arguments, results and errors..."
          aria-label="Search execution history"
        />
        <CustomSelect
          value={status}
          onChange={(val) => setStatus(val as typeof status)}
          options={statusOptions}
          placeholder="All statuses"
          className="w-36"
        />
        <CustomSelect
          value={surface}
          onChange={(val) => setSurface(val)}
          options={surfaceOptions}
          placeholder="All sources"
          className="w-36"
        />
      </div>

      {snapshot.lastError && (
        <div className={styles.storageError}>History storage degraded: {snapshot.lastError}</div>
      )}

      {/* Unified Per-Execution View: Stacked Run Charts on Left, Inspector on Right */}
      <div className={styles.runsDashboard}>
        {/* Left Column: Stacked Executions with Time-Series (Tools + Assistant Text) */}
        <div className={styles.runsOverview} aria-live="polite">
          {filteredRuns.length === 0 ? (
            <div className={styles.empty}>
              <Database size={28} />
              <strong>No execution runs found</strong>
              <span>Executions will appear here as agents run tools and stream responses.</span>
            </div>
          ) : (
            filteredRuns.map((run) => {
              const active = selectedInfo?.run.runId === run.runId;
              return (
                <RunCard
                  key={run.runId}
                  run={run}
                  active={active}
                  selectedItemId={active ? selectedItemId : null}
                  onSelectItem={handleSelectItem}
                />
              );
            })
          )}
        </div>

        {/* Right Column: Execution Item & Context Inspector */}
        <div className={styles.inspectorPanel} aria-label="Execution details inspector">
          {selectedInfo ? (
            <div>
              <div className={styles.inspectorHeader}>
                <div className="flex items-center gap-2">
                  {selectedInfo.item.kind === "tool" ? (
                    <>
                      {selectedInfo.item.record.status === "running" && (
                        <span className={`${styles.status} ${styles.status_running}`} />
                      )}
                      <strong className="text-[var(--color-fg-strong)] font-mono text-sm">
                        Execution Details: {selectedInfo.item.record.toolName}
                      </strong>
                      <span className="text-[var(--color-fg-muted)] text-xs">
                        {selectedInfo.item.record.status === "running" ? "Running · " : ""}
                        {formatDuration(selectedInfo.item.record)}
                      </span>
                    </>
                  ) : selectedInfo.item.kind === "reasoning" ? (
                    <>
                      <Brain size={15} className="text-[var(--color-primary)]" />
                      <strong className="text-[var(--color-fg-strong)] font-mono text-sm">
                        Reasoning
                      </strong>
                      <span className="text-[var(--color-fg-muted)] text-xs">
                        {formatTime(selectedInfo.item.timestamp)}
                      </span>
                    </>
                  ) : (
                    <>
                      <Bot size={15} className="text-[var(--color-primary)]" />
                      <strong className="text-[var(--color-fg-strong)] font-mono text-sm">
                        Assistant Response
                      </strong>
                      <span className="text-[var(--color-fg-muted)] text-xs">
                        {formatTime(selectedInfo.item.timestamp)}
                      </span>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={() => setSelectedItemId(null)}
                  title="Deselect item"
                  aria-label="Close inspector"
                >
                  <X size={15} />
                </button>
              </div>

              {selectedInfo.item.kind === "tool" ? (
                <ExecutionDetail record={selectedInfo.item.record} runTokens={selectedInfo.run.runTokens} runUsage={selectedInfo.run.usage} />
              ) : selectedInfo.item.kind === "reasoning" ? (
                <ReasoningDetail
                  item={selectedInfo.item}
                  requestPrompt={selectedInfo.run.requestPrompt}
                  tokens={selectedInfo.run.runTokens}
                  usage={selectedInfo.run.usage}
                  model={selectedInfo.run.model}
                  originLabel={selectedInfo.run.originLabel}
                  surface={selectedInfo.run.surface}
                />
              ) : (
                <AssistantTextDetail
                  item={selectedInfo.item}
                  requestPrompt={selectedInfo.run.requestPrompt}
                  tokens={selectedInfo.run.runTokens}
                  usage={selectedInfo.run.usage}
                  model={selectedInfo.run.model}
                  originLabel={selectedInfo.run.originLabel}
                  surface={selectedInfo.run.surface}
                />
              )}
            </div>
          ) : (
            <div className={styles.inspectorEmpty}>
              <Activity size={32} className="text-[var(--color-fg-muted)] opacity-60" />
              <strong>No tool call selected</strong>
              <span>Click any tool call, assistant response, or reasoning step on the timeline to the left to inspect details, output, and run context.</span>
            </div>
          )}
        </div>
      </div>

      <div className={styles.storageFooter}>
        <div>
          <strong>History on disk</strong>
          <span title="Saved under .rusty/observability in this workspace; limited only by disk space">
            {snapshot.records.length} calls across {groupedRuns.length} executions shown · .rusty/observability · {formatBytes(snapshot.storageBytes)}
          </span>
        </div>
        <AllTimeUsage refreshKey={snapshot.records.length} />
        <label className="flex items-center gap-1.5 text-[var(--color-fg-muted)] font-mono text-[var(--font-size-ui-xs)]">
          <span>Show</span>
          <CustomSelect
            value={String(snapshot.retentionDays ?? "unlimited")}
            onChange={(val) =>
              void executionObservability.setRetention(
                val === "unlimited" ? null : (Number(val) as 7 | 30 | 90)
              )
            }
            options={RETENTION_OPTIONS}
            direction="up"
            className="w-28"
          />
        </label>
        <button
          type="button"
          className={styles.dangerButton}
          onClick={() => {
            if (window.confirm("Permanently delete this workspace's saved execution history and run trajectories from .rusty/observability? Active runs will be kept. Token usage totals are not affected.")) {
              void executionObservability.clear();
            }
          }}
        >
          <Trash2 size={14} /> Clear history
        </button>
      </div>
    </aside>
  </div>
);
}
