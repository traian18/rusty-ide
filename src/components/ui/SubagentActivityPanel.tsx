import React, { useEffect, useState, useMemo } from "react";
import { AlertCircle, Bot, CheckCircle2, ChevronRight, Circle, Loader2, Terminal } from "lucide-react";
import type { SubagentActivity } from "./Chat";
import styles from "./SubagentActivityPanel.module.css";

interface SubagentActivityPanelProps {
  subagents: SubagentActivity[];
}

interface AgentActivityCardProps {
  content: string;
  isStreaming?: boolean;
  subagents?: SubagentActivity[];
}

const isSubagentActive = (status: SubagentActivity["status"]) =>
  status === "queued" || status === "running" || status === "background";

const subagentStatusLabel = (status: SubagentActivity["status"]) => {
  if (status === "background") return "running";
  if (status === "steered") return "completed";
  return status;
};

const subagentStats = (subagent: SubagentActivity) => {
  const parts: string[] = [];
  if (subagent.turnCount) parts.push(subagent.maxTurns ? `${subagent.turnCount}/${subagent.maxTurns} turns` : `${subagent.turnCount} turns`);
  if (subagent.toolUses) parts.push(`${subagent.toolUses} tools`);
  if (subagent.tokens) parts.push(subagent.tokens);
  if (subagent.durationMs) parts.push(`${Math.max(1, Math.round(subagent.durationMs / 1000))}s`);
  return parts.join(" · ");
};

export const SubagentActivityPanel: React.FC<SubagentActivityPanelProps> = ({ subagents }) => {
  const [now, setNow] = useState(() => Date.now());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const hasActiveSubagents = subagents.some((subagent) => isSubagentActive(subagent.status));

  useEffect(() => {
    if (!hasActiveSubagents) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [hasActiveSubagents]);

  if (subagents.length === 0) return null;

  const activeDuration = (subagent: SubagentActivity) => {
    const started = Date.parse(subagent.startedAt || subagent.updatedAt || "");
    if (Number.isNaN(started)) return "working";
    const seconds = Math.max(1, Math.floor((now - started) / 1000));
    return seconds < 60 ? `working ${seconds}s` : `working ${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  };

  const renderSubagentLogs = (subagent: SubagentActivity) => {
    const logs = subagent.logs || [];
    if (logs.length === 0 && !subagent.outputFile) return null;
    const visibleLogs = logs.slice(-12);

    return (
      <div className="mt-2 rounded bg-[var(--color-log-background)] border border-[var(--color-border-subtle)] overflow-hidden">
        <div className="px-2 py-1 border-b border-[var(--border-color)]/20 text-[length:var(--font-size-chat-xs)] uppercase tracking-wider text-[var(--text-muted)] flex items-center justify-between">
          <span>{subagent.isAggregation ? "Aggregation activity" : "Live tool activity"}</span>
          {logs.length > visibleLogs.length && (
            <span className="normal-case tracking-normal">last {visibleLogs.length} of {logs.length}</span>
          )}
        </div>
        <div className="px-2 py-1.5 max-h-56 overflow-y-auto font-mono text-[length:var(--font-size-chat-xs)] leading-relaxed text-[var(--color-log-foreground)]">
          {visibleLogs.map((log, idx) => (
            <div key={`${subagent.id}_log_${idx}`} className="whitespace-pre-wrap break-words">
              {log}
            </div>
          ))}
          {subagent.outputFile && (
            <div className="whitespace-pre-wrap break-words text-[var(--text-muted)]">
              Transcript: {subagent.outputFile}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={`chat-typography-scope ${styles.scope} px-4 py-3 bg-[var(--color-log-surface)] border-t border-[var(--color-border-subtle)]`}>
      <div className="flex items-center space-x-2 mb-2 text-[length:var(--font-size-chat-xs)] font-mono uppercase tracking-wider text-[var(--text-muted)]">
        <Bot size={12} className="text-[var(--accent-color)]" />
        <span>Subagents & aggregation</span>
        <span className="text-[length:var(--font-size-chat-xs)] normal-case tracking-normal text-[var(--text-muted)]">
          {subagents.filter((subagent) => isSubagentActive(subagent.status)).length} active · {subagents.filter((subagent) => !isSubagentActive(subagent.status)).length} done
        </span>
      </div>
      <div className="space-y-2">
        {subagents.map((subagent) => {
          const active = isSubagentActive(subagent.status);
          const failed = subagent.status === "error" || subagent.status === "aborted" || subagent.status === "stopped";
          const stats = subagentStats(subagent);
          const expanded = expandedIds.has(subagent.id);
          const detailsId = `delegation-details-${subagent.id.replace(/[^A-Za-z0-9_-]/g, "-")}`;
          const hasDetails = !!(
            subagent.result
            || subagent.error
            || subagent.scope?.length
            || subagent.excludedScope?.length
            || subagent.parentAgentId
          );
          return (
            <div key={subagent.id} id={`delegation-card-${subagent.id.replace(/[^A-Za-z0-9_-]/g, "-")}`} className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] px-3 py-2">
              <div className="flex items-start gap-2 text-[length:var(--font-size-chat-sm)] font-mono">
                {failed ? (
                  <AlertCircle size={13} className="mt-0.5 text-[var(--color-status-danger)] flex-shrink-0" />
                ) : active ? (
                  <Circle size={13} className="mt-0.5 animate-pulse text-[var(--color-status-info)] flex-shrink-0" />
                ) : subagent.isAggregation ? (
                  <Bot size={13} className="mt-0.5 text-[var(--color-status-success)] flex-shrink-0" />
                ) : (
                  <CheckCircle2 size={13} className="mt-0.5 text-[var(--color-status-success)] flex-shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className={failed ? "text-[var(--color-status-danger)]" : active ? "text-[var(--color-status-info)]" : "text-[var(--color-status-success)]"}>
                      {subagent.displayName || subagent.subagentType || "Agent"}
                    </span>
                    <span className="text-[length:var(--font-size-chat-xs)] uppercase tracking-wider text-[var(--text-muted)]">{subagentStatusLabel(subagent.status)}</span>
                    {stats && <span className="text-[length:var(--font-size-chat-xs)] text-[var(--text-muted)]">{stats}</span>}
                    {subagent.queuePosition && <span className="text-[length:var(--font-size-chat-xs)] text-[var(--text-muted)]">queue #{subagent.queuePosition}</span>}
                    {subagent.incorporated !== undefined && !active && (
                      <span className="text-[length:var(--font-size-chat-xs)] text-[var(--text-muted)]">
                        {subagent.incorporated ? "incorporated by parent" : "awaiting parent"}
                      </span>
                    )}
                  </div>
                  <div className="text-[var(--text-normal)] break-words">{subagent.description}</div>
                  {active && (
                    <div className="mt-1.5 flex items-center gap-1.5 rounded bg-[var(--color-status-info-bg)] border border-[var(--color-status-info-border)] px-2 py-1 text-[length:var(--font-size-chat-xs)] text-[var(--color-status-info)]">
                      <Circle size={7} className="animate-pulse text-[var(--color-status-info)] fill-[var(--color-status-info)] flex-shrink-0" />
                      <span className="min-w-0 flex-1 break-words">{subagent.activity || "Working on delegated task…"}</span>
                      <span className="text-[length:var(--font-size-chat-xs)] opacity-75 whitespace-nowrap">{activeDuration(subagent)}</span>
                    </div>
                  )}
                  {renderSubagentLogs(subagent)}
                  {hasDetails && (
                    <div className="mt-2">
                      <button
                        id={`delegation-toggle-${subagent.id.replace(/[^A-Za-z0-9_-]/g, "-")}`}
                        type="button"
                        aria-expanded={expanded}
                        aria-controls={detailsId}
                        aria-label={`${expanded ? "Hide" : "Show"} details for ${subagent.displayName || subagent.description}`}
                        onClick={() => setExpandedIds((current) => {
                          const next = new Set(current);
                          if (next.has(subagent.id)) next.delete(subagent.id);
                          else next.add(subagent.id);
                          return next;
                        })}
                        className="rounded border border-[var(--color-border-subtle)] px-2 py-1 text-[length:var(--font-size-chat-xs)] uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-normal)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-color)]"
                      >
                        {expanded ? "Hide details" : "Inspect details"}
                      </button>
                      {expanded && (
                        <div id={detailsId} className="mt-2 space-y-2 rounded border border-[var(--color-border-subtle)] bg-[var(--color-log-background)] p-2 text-[length:var(--font-size-chat-xs)] text-[var(--text-normal)]">
                          {subagent.parentAgentId && <div><span className="text-[var(--text-muted)]">Parent:</span> {subagent.parentAgentId}</div>}
                          {subagent.scope?.length ? <div><span className="text-[var(--text-muted)]">Scope:</span> {subagent.scope.join(", ")}</div> : null}
                          {subagent.excludedScope?.length ? <div><span className="text-[var(--text-muted)]">Excluded:</span> {subagent.excludedScope.join(", ")}</div> : null}
                          {subagent.expectedOutput && <div><span className="text-[var(--text-muted)]">Deliverable:</span> {subagent.expectedOutput}</div>}
                          {subagent.timeoutMs && <div><span className="text-[var(--text-muted)]">Timeout:</span> {Math.round(subagent.timeoutMs / 1000)}s</div>}
                          {subagent.error && <div role="alert" className="text-[var(--color-status-danger)] whitespace-pre-wrap">{subagent.error}</div>}
                          {subagent.result && (
                            <div>
                              <div className="mb-1 text-[var(--text-muted)]">Findings</div>
                              <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono">{subagent.result}</pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const AgentActivityCard: React.FC<AgentActivityCardProps> = ({
  content,
  isStreaming = false,
  subagents = [],
}) => {
  const [isCollapsed, setIsCollapsed] = useState(!isStreaming);
  const consoleLines = useMemo(() => content.split("\n").filter((line) => line.trim()), [content]);
  const visibleConsoleLines = consoleLines.slice(-12);

  return (
    <div className={`chat-typography-scope ${styles.scope} mb-4 bg-[var(--color-log-surface)] border border-[var(--color-border-default)] rounded-lg overflow-hidden shadow-sm`}>
      <button
        onClick={() => setIsCollapsed((collapsed) => !collapsed)}
        className="flex items-center justify-between px-3 py-2 text-[length:var(--font-size-chat-xs)] font-mono text-[var(--color-log-muted)] hover:text-[var(--color-fg-strong)] transition-all w-full text-left bg-[var(--color-log-header)] select-none cursor-pointer border-b border-[var(--color-border-subtle)]"
      >
        <div className="flex items-center space-x-2">
          <ChevronRight
            size={12}
            className={`transition-transform duration-200 text-[var(--accent-color)] ${isCollapsed ? "" : "rotate-90"}`}
          />
          <Terminal size={12} className="text-[var(--accent-color)]" />
          <span className="uppercase tracking-wider font-semibold">
            {isStreaming ? "Agent activity..." : "Agent activity"}
          </span>
          {consoleLines.length > visibleConsoleLines.length && (
            <span className="text-[length:var(--font-size-chat-xs)] normal-case tracking-normal text-[var(--text-muted)]">
              last {visibleConsoleLines.length} of {consoleLines.length}
            </span>
          )}
        </div>
        {isStreaming && <Loader2 size={11} className="animate-spin text-[var(--accent-color)]" />}
      </button>

      {!isCollapsed && (
        <div className="bg-[var(--color-log-background)] border-t border-[var(--color-border-subtle)]">
          <div className="px-4 py-3 max-h-64 overflow-y-auto font-mono text-[length:var(--font-size-chat-sm)] leading-relaxed text-[var(--color-log-foreground)]">
            <pre className="whitespace-pre-wrap font-mono">
              {visibleConsoleLines.join("\n") || "// Initializing agent workflow..."}
            </pre>
          </div>
          {subagents.length > 0 && <SubagentActivityPanel subagents={subagents} />}
        </div>
      )}
    </div>
  );
};
