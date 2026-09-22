import { RunTrajectoryView } from "./RunTrajectoryView";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Copy, Database, Trash2, X } from "lucide-react";
import { executionObservability } from "../../observability/executionStore";
import type { ToolExecutionRecord, ToolExecutionStatus } from "../../observability/types";
import { useExecutionObservability } from "../../observability/useExecutionObservability";
import { useWorkspaceStore } from "../../store";
import { CustomSelect } from "../CustomSelect";
import styles from "./ToolExecutionPanel.module.css";

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

function ExecutionDetail({ record }: { record: ToolExecutionRecord }) {
  const active = ["queued", "waiting-permission", "running"].includes(record.status);
  const sourceTabId = record.origin.tabId ?? record.origin.canvasId;
  const canOpenSource = useWorkspaceStore((state) => Boolean(sourceTabId && state.tabs.some((tab) => tab.id === sourceTabId)));
  const activateTab = useWorkspaceStore((state) => state.activateTab);
  const setSelectedNodeId = useWorkspaceStore((state) => state.setSelectedNodeId);

  const tokens = record.tokens;
  const hasTokens = Boolean(
    tokens && (
      tokens.totalTokens !== undefined ||
      tokens.inputTokens !== undefined ||
      tokens.outputTokens !== undefined
    )
  );

  return (
    <div className={styles.detail}>
      <dl className={styles.metadata}>
        <div><dt>Source</dt><dd>{record.origin.displayLabel}</dd></div>
        <div><dt>Surface</dt><dd>{record.origin.surface}</dd></div>
        {record.origin.canvasId && <div><dt>Canvas</dt><dd>{record.origin.canvasId}</dd></div>}
        {record.origin.nodeId && <div><dt>Node</dt><dd>{record.origin.nodeId}</dd></div>}
        <div><dt>Capability</dt><dd>{record.context.capability}</dd></div>
        {record.context.model && <div><dt>Model</dt><dd>{record.context.model}</dd></div>}
        {record.context.provider && <div><dt>Provider</dt><dd>{record.context.provider}</dd></div>}
        <div><dt>Tokens</dt><dd>{hasTokens && tokens?.totalTokens !== undefined ? `${tokens.totalTokens.toLocaleString()} total` : "Not reported"}</dd></div>
        <div><dt>Session</dt><dd>{record.sessionId ?? "—"}</dd></div>
        <div><dt>Agent</dt><dd>{record.agentId ?? "—"}</dd></div>
        {record.parentAgentId && <div><dt>Parent agent</dt><dd>{record.parentAgentId}</dd></div>}
        <div><dt>Call</dt><dd>{record.callId}</dd></div>
        <div><dt>Requested</dt><dd>{new Date(record.requestedAt).toLocaleString()}</dd></div>
        {record.startedAt && <div><dt>Started</dt><dd>{new Date(record.startedAt).toLocaleString()}</dd></div>}
        {record.finishedAt && <div><dt>Finished</dt><dd>{new Date(record.finishedAt).toLocaleString()}</dd></div>}
        {record.permission && <div><dt>Permission</dt><dd>{record.permission.state}</dd></div>}
      </dl>

      {/* Request Context (User prompt / instructions & file selection) */}
      {(record.context.requestPrompt || record.context.selection) && (
        <section className={styles.detailSection}>
          <div className={styles.sectionHeaderWithAction}>
            <h4>Request Context</h4>
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
          {record.context.requestPrompt && (
            <div className={styles.promptCard}>{record.context.requestPrompt}</div>
          )}
          {record.context.selection && (
            <div className={styles.selectionInfo}>
              <span className={styles.selectionLabel}>Target file:</span>
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
        <h4>Token Usage</h4>
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
          <p className={styles.tokenEmpty}>Token count not reported for this call</p>
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
        <h4>Arguments <small>{record.payloadState}</small></h4>
        <JsonValue value={record.arguments} />
      </section>
      {record.resultPreview !== undefined && (
        <section className={styles.detailSection}>
          <h4>{record.status === "failed" ? "Error" : "Result"}</h4>
          <JsonValue value={record.resultPreview} />
        </section>
      )}
      <section className={styles.detailSection}>
        <h4>Request summary</h4>
        <JsonValue value={record.context} />
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

export function ToolExecutionPanel({ onClose }: { onClose: () => void }) {
  const snapshot = useExecutionObservability();
  const [view, setView] = useState<"tools" | "trajectory">("tools");
  const [status, setStatus] = useState<"all" | ToolExecutionStatus>("all");
  const [surface, setSurface] = useState("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [onClose]);

  const surfaces = useMemo(() => [...new Set(snapshot.records.map((record) => record.origin.surface))], [snapshot.records]);
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

  const records = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return snapshot.records.filter((record) => {
      if (status !== "all" && record.status !== status) return false;
      if (surface !== "all" && record.origin.surface !== surface) return false;
      return !needle || `${record.toolName} ${record.origin.displayLabel} ${record.context.capability} ${record.resultPreview ?? ""} ${JSON.stringify(record.arguments)}`.toLowerCase().includes(needle);
    });
  }, [query, snapshot.records, status, surface]);

  return (
    <aside id="tool-execution-panel" className={styles.panel} role="dialog" aria-modal="false" aria-label="Tool execution">
      <div className={styles.panelHeader}>
        <div><h2>Tool execution</h2><p>Live and local execution history</p></div>
        <button ref={closeRef} type="button" className={styles.iconButton} aria-label="Close tool execution" onClick={onClose}><X size={17} /></button>
      </div>

      <div className={styles.viewTabs} aria-label="Execution view">
        <button type="button" aria-pressed={view === "tools"} onClick={() => setView("tools")}>Tools</button>
        <button type="button" aria-pressed={view === "trajectory"} onClick={() => setView("trajectory")}>Run trajectory</button>
      </div>
      {view === "trajectory" ? <RunTrajectoryView /> : <>
      <div className={styles.filters}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tools, results and errors" aria-label="Search execution history" />
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

      {snapshot.lastError && <div className={styles.storageError}>History storage degraded: {snapshot.lastError}</div>}

      <div className={styles.list} aria-live="polite">
        {records.length === 0 ? (
          <div className={styles.empty}><Database size={28} /><strong>No tool executions</strong><span>Calls will appear here as agents use tools.</span></div>
        ) : records.map((record) => {
          const isExpanded = expanded === record.id;
          return (
            <article key={record.id} className={styles.record}>
              <button type="button" className={styles.recordSummary} aria-expanded={isExpanded} onClick={() => setExpanded(isExpanded ? null : record.id)}>
                {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                <span className={`${styles.status} ${styles[`status_${record.status}`]}`} aria-label={STATUS_LABEL[record.status]} />
                <span className={styles.recordIdentity}><strong>{record.toolName}</strong><small>{record.origin.displayLabel}</small></span>
                <span className={styles.recordMeta}>
                  <time>{new Date(record.requestedAt).toLocaleTimeString()}</time>
                  <small>
                    {record.tokens?.totalTokens !== undefined ? `${record.tokens.totalTokens.toLocaleString()} tok · ` : ""}
                    {STATUS_LABEL[record.status]} · {formatDuration(record)}
                  </small>
                </span>
              </button>
              {isExpanded && <ExecutionDetail record={record} />}
            </article>
          );
        })}
      </div>

      </>}
      <div className={styles.storageFooter}>
        <div><strong>Local history</strong><span>{snapshot.records.length} calls · {formatBytes(snapshot.storageBytes)}</span></div>
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
        <button type="button" className={styles.dangerButton} onClick={() => {
          if (window.confirm("Delete all saved tool execution history and run trajectories? Active runs will be kept.")) executionObservability.clear();
        }}><Trash2 size={14} /> Clear history</button>
      </div>
    </aside>
  );
}
