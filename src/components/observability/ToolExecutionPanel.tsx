import { RunExecutionTimeline, type TimelineItem } from "./RunExecutionTimeline";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bot,
  Copy,
  Database,
  FileCode2,
  Info,
  Trash2,
  X,
} from "lucide-react";
import { extractCallSummary } from "./callSummary";
import { executionObservability } from "../../observability/executionStore";
import { useTrajectories, type TrajectoryEntry } from "../../observability/trajectoryStore";
import type { ExecutionTokensSnapshot, ToolExecutionRecord, ToolExecutionStatus } from "../../observability/types";
import { useExecutionObservability } from "../../observability/useExecutionObservability";
import { useWorkspaceStore } from "../../store";
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
  { id: "unlimited", name: "Forever" },
];

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

function JsonValue({ value }: { value: unknown }) {
  return <pre className={styles.code}>{JSON.stringify(value, null, 2) ?? "—"}</pre>;
}

function ExecutionDetail({ record, runTokens }: { record: ToolExecutionRecord; runTokens?: ExecutionTokensSnapshot }) {
  const active = ["queued", "waiting-permission", "running"].includes(record.status);
  const sourceTabId = record.origin.tabId ?? record.origin.canvasId;
  const canOpenSource = useWorkspaceStore((state) => Boolean(sourceTabId && state.tabs.some((tab) => tab.id === sourceTabId)));
  const activateTab = useWorkspaceStore((state) => state.activateTab);
  const setSelectedNodeId = useWorkspaceStore((state) => state.setSelectedNodeId);
  const callSummary = extractCallSummary(record);

  const tokens = runTokens ?? record.tokens;
  const hasTokens = Boolean(
    tokens && (
      tokens.totalTokens !== undefined ||
      tokens.inputTokens !== undefined ||
      tokens.outputTokens !== undefined
    )
  );

  return (
    <div className={styles.detail}>
      {/* What the call is: Prominent Action Banner */}
      <div className={styles.callBanner}>
        <div className={styles.callBannerTop}>
          <span className={styles.callBannerBadge}>
            <FileCode2 size={15} className="text-[var(--color-primary)]" />
            {record.toolName}
          </span>
          <span className={`${styles.status} ${styles[`status_${record.status}`]}`} aria-label={STATUS_LABEL[record.status]} />
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

      {/* Call Output or Error */}
      {record.resultPreview !== undefined && (
        <section className={styles.detailSection}>
          <div className={styles.sectionHeaderWithAction}>
            <h4>{record.status === "failed" ? "Call Error" : "Call Result / Output"}</h4>
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

      {/* Token Usage Breakdown */}
      <section className={styles.detailSection}>
        <h4>Run Token Usage <small>(Model Total)</small></h4>
        {hasTokens && tokens ? (
          <div className={styles.tokenGrid}>
            <div className={`${styles.tokenCard} ${styles.tokenCardHighlight}`}>
              <span className={styles.tokenLabel}>Total Tokens</span>
              <strong className={styles.tokenValue}>{tokens.totalTokens?.toLocaleString() ?? "—"}</strong>
            </div>
            {tokens.inputTokens !== undefined && (
              <div className={styles.tokenCard}>
                <span className={styles.tokenLabel}>Input (Prompt)</span>
                <span className={styles.tokenValue}>{tokens.inputTokens.toLocaleString()}</span>
              </div>
            )}
            {tokens.outputTokens !== undefined && (
              <div className={styles.tokenCard}>
                <span className={styles.tokenLabel}>Output (Completion)</span>
                <span className={styles.tokenValue}>{tokens.outputTokens.toLocaleString()}</span>
              </div>
            )}
            {tokens.cacheReadTokens !== undefined && (
              <div className={styles.tokenCard}>
                <span className={styles.tokenLabel}>Cache Read</span>
                <span className={styles.tokenValue}>{tokens.cacheReadTokens.toLocaleString()}</span>
              </div>
            )}
            {tokens.cacheWriteTokens !== undefined && (
              <div className={styles.tokenCard}>
                <span className={styles.tokenLabel}>Cache Write</span>
                <span className={styles.tokenValue}>{tokens.cacheWriteTokens.toLocaleString()}</span>
              </div>
            )}
            {tokens.reasoningTokens !== undefined && (
              <div className={styles.tokenCard}>
                <span className={styles.tokenLabel}>Reasoning</span>
                <span className={styles.tokenValue}>{tokens.reasoningTokens.toLocaleString()}</span>
              </div>
            )}
          </div>
        ) : (
          <p className={styles.tokenEmpty}>Token count not reported for this run</p>
        )}
      </section>

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
          {record.context.model && <div><dt>Model</dt><dd>{record.context.model}</dd></div>}
          {record.context.provider && <div><dt>Provider</dt><dd>{record.context.provider}</dd></div>}
          <div><dt>Session</dt><dd>{record.sessionId ?? "—"}</dd></div>
          <div><dt>Agent</dt><dd>{record.agentId ?? "—"}</dd></div>
          {record.parentAgentId && <div><dt>Parent agent</dt><dd>{record.parentAgentId}</dd></div>}
          <div><dt>Call ID</dt><dd>{record.callId}</dd></div>
          <div><dt>Requested</dt><dd>{new Date(record.requestedAt).toLocaleString()}</dd></div>
          {record.startedAt && <div><dt>Started</dt><dd>{new Date(record.startedAt).toLocaleString()}</dd></div>}
          {record.finishedAt && <div><dt>Finished</dt><dd>{new Date(record.finishedAt).toLocaleString()}</dd></div>}
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
  model,
  originLabel,
  surface,
}: {
  item: TimelineAssistantTextItem;
  requestPrompt?: string;
  tokens?: ExecutionTokensSnapshot;
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
            {new Date(item.timestamp).toLocaleTimeString()}
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

      {/* Run Token Usage */}
      <section className={styles.detailSection}>
        <h4>Run Token Usage <small>(Model Total)</small></h4>
        {tokens && tokens.totalTokens !== undefined ? (
          <div className={styles.tokenGrid}>
            <div className={`${styles.tokenCard} ${styles.tokenCardHighlight}`}>
              <span className={styles.tokenLabel}>Total Tokens</span>
              <strong className={styles.tokenValue}>{tokens.totalTokens.toLocaleString()}</strong>
            </div>
            {tokens.inputTokens !== undefined && (
              <div className={styles.tokenCard}>
                <span className={styles.tokenLabel}>Input (Prompt)</span>
                <span className={styles.tokenValue}>{tokens.inputTokens.toLocaleString()}</span>
              </div>
            )}
            {tokens.outputTokens !== undefined && (
              <div className={styles.tokenCard}>
                <span className={styles.tokenLabel}>Output (Completion)</span>
                <span className={styles.tokenValue}>{tokens.outputTokens.toLocaleString()}</span>
              </div>
            )}
            {tokens.cacheReadTokens !== undefined && (
              <div className={styles.tokenCard}>
                <span className={styles.tokenLabel}>Cache Read</span>
                <span className={styles.tokenValue}>{tokens.cacheReadTokens.toLocaleString()}</span>
              </div>
            )}
            {tokens.cacheWriteTokens !== undefined && (
              <div className={styles.tokenCard}>
                <span className={styles.tokenLabel}>Cache Write</span>
                <span className={styles.tokenValue}>{tokens.cacheWriteTokens.toLocaleString()}</span>
              </div>
            )}
          </div>
        ) : (
          <p className={styles.tokenEmpty}>Token count not reported for this run</p>
        )}
      </section>

      {/* Metadata */}
      <section className={styles.detailSection}>
        <h4>Execution Metadata</h4>
        <dl className={styles.metadata}>
          <div><dt>Source</dt><dd>{originLabel}</dd></div>
          <div><dt>Surface</dt><dd>{surface}</dd></div>
          {model && <div><dt>Model</dt><dd>{model}</dd></div>}
          <div><dt>Timestamp</dt><dd>{new Date(item.timestamp).toLocaleString()}</dd></div>
        </dl>
      </section>
    </div>
  );
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

  const groupedRuns = useMemo<GroupedRun[]>(() => {
    const runMap = new Map<string, ToolExecutionRecord[]>();

    for (const record of snapshot.records) {
      const key = record.ideRunId || record.sessionId || `adhoc-${record.id}`;
      const group = runMap.get(key) ?? [];
      group.push(record);
      runMap.set(key, group);
    }

    const runs: GroupedRun[] = [];

    for (const [runId, records] of runMap.entries()) {
      const sortedRecords = [...records].sort(
        (a, b) =>
          Date.parse(a.startedAt || a.requestedAt) -
          Date.parse(b.startedAt || b.requestedAt)
      );
      const firstRecord = sortedRecords[0];
      const lastRecord = sortedRecords[sortedRecords.length - 1];

      const traj = trajectorySnapshot.runs.find(
        (r) => r.id === runId || (firstRecord.sessionId && r.sessionId === firstRecord.sessionId)
      );

      const startedAt = traj?.startedAt || firstRecord.startedAt || firstRecord.requestedAt;
      const finishedAt = lastRecord.finishedAt;
      const durationMs =
        startedAt && finishedAt
          ? Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt))
          : undefined;

      const hasRunning =
        sortedRecords.some((r) =>
          ["queued", "waiting-permission", "running"].includes(r.status)
        ) || traj?.status === "running";
      const hasFailed =
        sortedRecords.some((r) => r.status === "failed") || traj?.status === "failed";
      const allCancelled =
        (sortedRecords.length > 0 && sortedRecords.every((r) => r.status === "cancelled")) ||
        traj?.status === "cancelled";

      const runStatus: GroupedRun["status"] = hasRunning
        ? "running"
        : hasFailed
        ? "failed"
        : allCancelled
        ? "cancelled"
        : "succeeded";

      // Calculate max run tokens rather than summing duplicates
      const runTokens = sortedRecords.reduce<ExecutionTokensSnapshot | undefined>((acc, r) => {
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

      const toolItems: TimelineToolItem[] = sortedRecords.map((record) => ({
        kind: "tool",
        id: record.id,
        timestamp: record.startedAt || record.requestedAt,
        record,
      }));

      const timelineItems: TimelineItem[] = [...toolItems, ...textItems].sort(
        (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)
      );

      runs.push({
        runId,
        sessionId: firstRecord.sessionId,
        status: runStatus,
        startedAt,
        finishedAt,
        durationMs,
        originLabel: traj?.origin.displayLabel || firstRecord.origin.displayLabel || "Execution",
        surface: traj?.origin.surface || firstRecord.origin.surface || "agent",
        capability: traj?.context.capability || firstRecord.context.capability,
        model: traj?.context.model || firstRecord.context.model,
        provider: traj?.context.provider || firstRecord.context.provider,
        requestPrompt:
          traj?.context.requestPrompt ||
          sortedRecords.find((r) => r.context.requestPrompt)?.context.requestPrompt,
        totalTokens: runTokens?.totalTokens,
        runTokens,
        records: sortedRecords,
        timelineItems,
        entries: trajEntries,
      });
    }

    // Include any trajectory runs that had no tool calls recorded
    for (const traj of trajectorySnapshot.runs) {
      if (!runMap.has(traj.id)) {
        const textItems: TimelineAssistantTextItem[] = [];
        for (const entry of traj.entries) {
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
        const timelineItems = textItems.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

        runs.push({
          runId: traj.id,
          sessionId: traj.sessionId,
          status:
            traj.status === "running"
              ? "running"
              : traj.status === "failed"
              ? "failed"
              : traj.status === "cancelled"
              ? "cancelled"
              : "succeeded",
          startedAt: traj.startedAt,
          originLabel: traj.origin.displayLabel,
          surface: traj.origin.surface,
          capability: traj.context.capability,
          model: traj.context.model,
          provider: traj.context.provider,
          requestPrompt: traj.context.requestPrompt,
          records: [],
          timelineItems,
          entries: traj.entries,
        });
      }
    }

    runs.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
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
        it.kind === "assistant_text" && it.text.toLowerCase().includes(needle)
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

  const handleSelectItem = (itemId: string) => {
    setSelectedItemId((prev) => (prev === itemId ? null : itemId));
  };

  return (
    <aside id="tool-execution-panel" className={styles.panel} role="dialog" aria-modal="false" aria-label="Tool execution">
      <div className={styles.panelHeader}>
        <div>
          <h2>
            <Activity size={18} className="text-[var(--color-primary)]" />
            Tool Execution Observability
          </h2>
          <p>
            {snapshot.records.length} calls across {groupedRuns.length} executions · DeepSeek timeline view per run
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
              const isRunActive = selectedInfo && selectedInfo.run.runId === run.runId;
              return (
                <article
                  key={run.runId}
                  className={`${styles.runCard} ${isRunActive ? styles.runCardActive : ""}`}
                >
                  <div className={styles.runCardHeader}>
                    <div className={styles.runIdentity}>
                      <span className={`${styles.runStatusBadge} ${styles[`runStatus_${run.status}`]}`}>
                        {run.status}
                      </span>
                      <strong className={styles.runPromptPreview} title={run.requestPrompt || run.originLabel}>
                        {run.requestPrompt ? `"${run.requestPrompt}"` : run.originLabel}
                      </strong>
                      {run.capability && <span className={styles.runMetaPill}>{run.capability}</span>}
                      {run.model && <span className={styles.runMetaPill}>{run.model}</span>}
                      <span className={styles.runMetaPill}>{run.surface}</span>
                    </div>
                    <div className={styles.runStats}>
                      <span>{new Date(run.startedAt).toLocaleTimeString()}</span>
                      <span>{run.records.length} {run.records.length === 1 ? "call" : "calls"}</span>
                      {run.durationMs !== undefined && <span>{(run.durationMs / 1000).toFixed(1)}s</span>}
                      {run.totalTokens !== undefined && <span>{run.totalTokens.toLocaleString()} tok</span>}
                    </div>
                  </div>

                  {/* Horizontal DeepSeek-style Time Series Execution Chart */}
                  <RunExecutionTimeline
                    items={run.timelineItems}
                    selectedItemId={selectedItemId}
                    onSelectItem={handleSelectItem}
                    runStartedAt={run.startedAt}
                  />

                  {/* Inline Collapsible Event Trace */}
                  {run.entries.length > 0 && (
                    <details className={styles.runTraceDetails}>
                      <summary>Event Trace ({run.entries.length} raw events)</summary>
                      <div className={styles.runTraceList}>
                        {run.entries.map((entry, index) => (
                          <details key={entry.id} className={styles.trajectoryEntry}>
                            <summary>
                              <span>{entry.sequence ?? index + 1} · {entry.source}</span>
                              <small>{new Date(entry.timestamp).toLocaleTimeString()} · {entry.payloadState}</small>
                            </summary>
                            <div className={styles.detail}>
                              {entry.agentId && <p className="text-xs text-[var(--color-fg-muted)] m-0">Agent: {entry.agentId}</p>}
                              {(entry.eventCount ?? 0) > 1 && (
                                <p className="text-xs text-[var(--color-fg-muted)] m-0">
                                  {entry.eventCount} streamed chunks grouped in order
                                </p>
                              )}
                              <pre className={styles.code}>{JSON.stringify(entry.payload, null, 2)}</pre>
                            </div>
                          </details>
                        ))}
                      </div>
                    </details>
                  )}
                </article>
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
                      <span className={`${styles.status} ${styles[`status_${selectedInfo.item.record.status}`]}`} />
                      <strong className="text-[var(--color-fg-strong)] font-mono text-sm">
                        Execution Details: {selectedInfo.item.record.toolName}
                      </strong>
                      <span className="text-[var(--color-fg-muted)] text-xs">
                        {STATUS_LABEL[selectedInfo.item.record.status]} · {formatDuration(selectedInfo.item.record)}
                      </span>
                    </>
                  ) : (
                    <>
                      <Bot size={15} className="text-[var(--color-primary)]" />
                      <strong className="text-[var(--color-fg-strong)] font-mono text-sm">
                        Assistant Response
                      </strong>
                      <span className="text-[var(--color-fg-muted)] text-xs">
                        {new Date(selectedInfo.item.timestamp).toLocaleTimeString()}
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
                <ExecutionDetail record={selectedInfo.item.record} runTokens={selectedInfo.run.runTokens} />
              ) : (
                <AssistantTextDetail
                  item={selectedInfo.item}
                  requestPrompt={selectedInfo.run.requestPrompt}
                  tokens={selectedInfo.run.runTokens}
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
              <span>Click any tool call or assistant response on the timeline to the left to inspect details, output, and run context.</span>
            </div>
          )}
        </div>
      </div>

      <div className={styles.storageFooter}>
        <div>
          <strong>Local history</strong>
          <span>
            {snapshot.records.length} calls across {groupedRuns.length} executions · {formatBytes(snapshot.storageBytes)}
          </span>
        </div>
        <label className="flex items-center gap-1.5 text-[var(--color-fg-muted)] font-mono text-[var(--font-size-ui-xs)]">
          <span>Keep</span>
          <CustomSelect
            value={String(snapshot.retentionDays ?? "unlimited")}
            onChange={(val) =>
              executionObservability.setRetention(
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
            if (window.confirm("Delete all saved execution history and run trajectories? Active runs will be kept.")) {
              executionObservability.clear();
            }
          }}
        >
          <Trash2 size={14} /> Clear history
        </button>
      </div>
    </aside>
  );
}
