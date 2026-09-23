import React from "react";
import { Loader2, Clock, AlertTriangle, FileCode2, Bot, MessageSquare } from "lucide-react";
import type { ToolExecutionRecord, ToolExecutionStatus } from "../../observability/types";
import { extractCallSummary, formatCompactCallLabel } from "./callSummary";
import styles from "./ToolExecutionPanel.module.css";

export type TimelineItem =
  | {
      kind: "tool";
      id: string;
      record: ToolExecutionRecord;
      timestamp: string;
    }
  | {
      kind: "assistant_text";
      id: string;
      messageId: string;
      text: string;
      timestamp: string;
      agentId?: string;
    };

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
  if (diffMs < 1_000) return `+${diffMs}ms`;
  return `+${(diffMs / 1_000).toFixed(1)}s`;
}

function getStatusIcon(status: ToolExecutionStatus) {
  switch (status) {
    case "running":
      return <Loader2 size={13} className={`${styles.nodeIconRunning} animate-spin`} />;
    case "waiting-permission":
      return <AlertTriangle size={13} className={styles.nodeIconWarning} />;
    case "queued":
      return <Clock size={13} className={styles.nodeIconQueued} />;
    case "succeeded":
    case "failed":
    case "cancelled":
    default:
      return <FileCode2 size={11} className={styles.nodeToolIcon} />;
  }
}

export const RunExecutionTimeline: React.FC<RunExecutionTimelineProps> = ({
  items,
  records,
  selectedItemId,
  selectedRecordId,
  onSelectItem,
  onSelectRecord,
  runStartedAt,
}) => {
  const effectiveItems: TimelineItem[] = items ?? (records || []).map((r) => ({
    kind: "tool" as const,
    id: r.id,
    record: r,
    timestamp: r.startedAt || r.requestedAt,
  }));

  const selectedId = selectedItemId ?? selectedRecordId ?? null;
  const handleSelect = onSelectItem ?? onSelectRecord ?? (() => {});

  if (!effectiveItems || effectiveItems.length === 0) {
    return (
      <div className={styles.emptyTimeline}>
        <span>No execution events recorded in this run.</span>
      </div>
    );
  }

  const effectiveStart = runStartedAt || effectiveItems[0]?.timestamp;

  return (
    <div className={styles.timelineContainer}>
      <div className={styles.timelineTrack}>
        {effectiveItems.map((item, index) => {
          const isSelected = selectedId === item.id;
          const isLast = index === effectiveItems.length - 1;
          const offsetLabel = formatRelativeOffset(item.timestamp, effectiveStart);

          if (item.kind === "assistant_text") {
            const wordCount = item.text.trim().split(/\s+/).filter(Boolean).length;
            const preview = item.text.replace(/\s+/g, " ").trim().slice(0, 30);

            return (
              <React.Fragment key={item.id}>
                <button
                  type="button"
                  className={`${styles.timelineNode} ${isSelected ? styles.timelineNodeSelected : ""}`}
                  onClick={() => handleSelect(item.id)}
                  title={`Click to inspect Assistant Response (${wordCount} words): "${preview}..."`}
                  aria-pressed={isSelected}
                  aria-label={`Assistant response ${index + 1}: ${wordCount} words, "${preview}"`}
                >
                  <span className={styles.nodeTimeOffset}>
                    {offsetLabel || `#${index + 1}`}
                  </span>
                  <div className={styles.nodeMarkerWrapper}>
                    <div className={`${styles.nodeMarker} ${styles.nodeMarkerText}`}>
                      <Bot size={13} className={styles.nodeIconText} />
                    </div>
                  </div>
                  <div className={`${styles.nodePill} ${styles.nodePillText}`}>
                    <MessageSquare size={11} className={styles.nodeTextIcon} />
                    <strong className={styles.nodeToolName}>Assistant</strong>
                    <span className={styles.nodeDuration}>{wordCount}w</span>
                  </div>
                  {isSelected && <div className={styles.nodeSelectedCaret} />}
                </button>

                {!isLast && (
                  <div className={styles.timelineConnector} aria-hidden="true" />
                )}
              </React.Fragment>
            );
          }

          // Tool call item
          const record = item.record;
          const durationLabel = formatDuration(record.durationMs, record.status);
          const callSummary = extractCallSummary(record);
          const compactLabel = formatCompactCallLabel(record);

          return (
            <React.Fragment key={record.id}>
              <button
                type="button"
                className={`${styles.timelineNode} ${isSelected ? styles.timelineNodeSelected : ""}`}
                onClick={() => handleSelect(record.id)}
                title={`Click to inspect: ${callSummary.actionLabel} (${durationLabel})`}
                aria-pressed={isSelected}
                aria-label={`Tool execution ${index + 1}: ${compactLabel}, duration ${durationLabel}`}
              >
                {/* Node Time Marker */}
                <span className={styles.nodeTimeOffset}>
                  {offsetLabel || `#${index + 1}`}
                </span>

                {/* Node Circular Marker on the Rail */}
                <div className={styles.nodeMarkerWrapper}>
                  <div className={styles.nodeMarker}>
                    {getStatusIcon(record.status)}
                  </div>
                </div>

                {/* Node Label Capsule */}
                <div className={styles.nodePill}>
                  <FileCode2 size={11} className={styles.nodeToolIcon} />
                  <strong className={styles.nodeToolName}>{compactLabel}</strong>
                  <span className={styles.nodeDuration}>{durationLabel}</span>
                </div>

                {/* Selected Indicator Arrow */}
                {isSelected && <div className={styles.nodeSelectedCaret} />}
              </button>

              {/* Connecting Rail Segment between Nodes */}
              {!isLast && (
                <div
                  className={`${styles.timelineConnector} ${record.status === "running" ? styles.timelineConnectorRunning : ""}`}
                  aria-hidden="true"
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
