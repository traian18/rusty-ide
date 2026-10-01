import React, { memo, useCallback, useMemo } from "react";
import { AlertTriangle, Bot, Brain, Clock, FileCode2, Loader2, MessageSquare } from "lucide-react";
import type { ToolExecutionRecord, ToolExecutionStatus } from "../../observability/types";
import { describeCallModels, extractCallSummary, formatCompactCallLabel } from "./callSummary";
import styles from "./ToolExecutionPanel.module.css";

export type TimelineItem =
  | { kind: "tool"; id: string; record: ToolExecutionRecord; timestamp: string }
  | { kind: "assistant_text"; id: string; messageId: string; text: string; timestamp: string; agentId?: string }
  | { kind: "reasoning"; id: string; messageId: string; text: string; timestamp: string; agentId?: string };

export interface RunExecutionTimelineProps {
  items?: TimelineItem[];
  records?: ToolExecutionRecord[];
  selectedItemId?: string | null;
  selectedRecordId?: string | null;
  onSelectItem?: (id: string) => void;
  onSelectRecord?: (id: string) => void;
  runStartedAt?: string;
}

function formatDuration(ms?: number, status?: ToolExecutionStatus): string {
  if (ms === undefined) return status === "running" ? "Live" : "—";
  if (ms < 1_000) return `${ms}ms`;
  return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}
function formatRelativeOffset(itemTime: string, runStartTime?: string): string {
  if (!runStartTime) return "";
  const diffMs = Date.parse(itemTime) - Date.parse(runStartTime);
  if (isNaN(diffMs) || diffMs < 0) return "0.0s";
  return diffMs < 1_000 ? `+${diffMs}ms` : `+${(diffMs / 1_000).toFixed(1)}s`;
}
function getStatusIcon(status: ToolExecutionStatus, delegated: boolean) {
  const className = delegated ? styles.nodeIconSuccess : undefined;
  if (status === "running") return <Loader2 size={13} className={`${className ?? styles.nodeIconRunning} animate-spin`} />;
  if (status === "waiting-permission") return <AlertTriangle size={13} className={styles.nodeIconWarning} />;
  if (status === "queued") return <Clock size={13} className={styles.nodeIconQueued} />;
  return <FileCode2 size={11} className={className ?? styles.nodeToolIcon} />;
}

interface NodeProps {
  item: TimelineItem;
  position: number;
  isLast: boolean;
  selected: boolean;
  effectiveStart?: string;
  onSelect: (id: string) => void;
}

const TextTimelineNode = memo(function TextTimelineNode({ item, position, isLast, selected, effectiveStart, onSelect }: NodeProps) {
  if (item.kind === "tool") return null;
  const reasoning = item.kind === "reasoning";
  const count = reasoning ? estimateTokens(item.text) : item.text.trim().split(/\s+/).filter(Boolean).length;
  const preview = item.text.replace(/\s+/g, " ").trim().slice(0, 30);
  const Icon = reasoning ? Brain : Bot;
  const label = reasoning ? "Reasoning" : "Assistant";
  const offsetLabel = formatRelativeOffset(item.timestamp, effectiveStart);
  return <>
    <button id={`timeline-item-${item.id}`} type="button" className={`${styles.timelineNode} ${selected ? styles.timelineNodeSelected : ""}`} onClick={() => onSelect(item.id)} title={`Click to inspect ${label}: "${preview}..."`} aria-pressed={selected} aria-label={`${label} ${position}`}>
      <span className={styles.nodeTimeOffset}>{offsetLabel || `#${position}`}</span>
      <div className={styles.nodeMarkerWrapper}><div className={`${styles.nodeMarker} ${reasoning ? styles.nodeMarkerReasoning : styles.nodeMarkerText}`}><Icon size={13} className={reasoning ? styles.nodeIconReasoning : styles.nodeIconText} /></div></div>
      <div className={`${styles.nodePill} ${reasoning ? styles.nodePillReasoning : styles.nodePillText}`}>
        {reasoning ? <Brain size={11} className={styles.nodeReasoningIcon} /> : <MessageSquare size={11} className={styles.nodeTextIcon} />}
        <strong className={styles.nodeToolName}>{label}</strong><span className={styles.nodeDuration}>{reasoning ? `~${count} tok` : `${count}w`}</span>
      </div>
      {selected && <div className={styles.nodeSelectedCaret} />}
    </button>
    {!isLast && <div className={styles.timelineConnector} aria-hidden="true" />}
  </>;
});

const ToolTimelineNode = memo(function ToolTimelineNode({ item, position, isLast, selected, effectiveStart, onSelect }: NodeProps) {
  if (item.kind !== "tool") return null;
  const record = item.record;
  const models = describeCallModels(record);
  const durationLabel = formatDuration(record.durationMs, record.status);
  const callSummary = extractCallSummary(record);
  const compactLabel = formatCompactCallLabel(record);
  const modelDescription = ` Requested by ${models.requestedBy}. Executed by ${models.executedBy}.`;
  const offsetLabel = formatRelativeOffset(item.timestamp, effectiveStart);
  return <>
    <button id={`timeline-tool-${record.id}`} type="button" className={`${styles.timelineNode} ${selected ? styles.timelineNodeSelected : ""}`} onClick={() => onSelect(record.id)} title={`Click to inspect: ${callSummary.actionLabel} (${durationLabel}).${modelDescription}`} aria-pressed={selected} aria-label={`Tool execution ${position}: ${compactLabel}, duration ${durationLabel}${modelDescription}`}>
      <span className={styles.nodeTimeOffset}>{offsetLabel || `#${position}`}</span>
      <div className={styles.nodeMarkerWrapper}><div className={styles.nodeMarker}>{getStatusIcon(record.status, models.delegated)}</div></div>
      <div className={styles.nodePill}><FileCode2 size={11} className={models.delegated ? styles.nodeIconSuccess : styles.nodeToolIcon} /><strong className={styles.nodeToolName}>{compactLabel}</strong><span className={styles.nodeDuration}>{durationLabel}</span></div>
      {selected && <div className={styles.nodeSelectedCaret} />}
    </button>
    {!isLast && <div className={`${styles.timelineConnector} ${record.status === "running" ? styles.timelineConnectorRunning : ""}`} aria-hidden="true" />}
  </>;
});

const noop = () => {};
export const RunExecutionTimeline: React.FC<RunExecutionTimelineProps> = ({ items, records, selectedItemId, selectedRecordId, onSelectItem, onSelectRecord, runStartedAt }) => {
  const effectiveItems = useMemo<TimelineItem[]>(() => items ?? (records || []).map((record) => ({ kind: "tool", id: record.id, record, timestamp: record.startedAt || record.requestedAt })), [items, records]);
  const selectedId = selectedItemId ?? selectedRecordId ?? null;
  const select = onSelectItem ?? onSelectRecord ?? noop;
  const handleSelect = useCallback((id: string) => select(id), [select]);
  if (!effectiveItems.length) return <div className={styles.emptyTimeline}><span>No execution events recorded in this run.</span></div>;
  const effectiveStart = runStartedAt || effectiveItems[0]?.timestamp;
  return <div className={styles.timelineContainer}><div className={styles.timelineTrack}>
    {effectiveItems.map((item, index) => {
      const props: NodeProps = { item, position: index + 1, isLast: index === effectiveItems.length - 1, selected: selectedId === item.id, effectiveStart, onSelect: handleSelect };
      return item.kind === "tool" ? <ToolTimelineNode key={item.id} {...props} /> : <TextTimelineNode key={item.id} {...props} />;
    })}
  </div></div>;
};

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
