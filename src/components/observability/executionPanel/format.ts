import type { UsageTotals } from "../../../store";
import type { ToolExecutionRecord } from "../../../observability/types";

export function formatTokens(value: number): string {
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${(value / 1_000).toFixed(1)}k` : String(Math.round(value));
}

export function describeTotals(totals: UsageTotals): string {
  const parts = [`${formatTokens(totals.input)} in`, `${formatTokens(totals.output)} out`];
  if (totals.cacheRead) parts.push(`${formatTokens(totals.cacheRead)} cache read`);
  if (totals.cacheWrite) parts.push(`${formatTokens(totals.cacheWrite)} cache write`);
  if (totals.reasoning) parts.push(`${formatTokens(totals.reasoning)} reasoning`);
  return `${parts.join(" · ")} · ${totals.calls.toLocaleString()} calls`;
}

export function formatDuration(record: ToolExecutionRecord): string {
  if (record.durationMs === undefined) return record.status === "running" ? "Live" : "—";
  if (record.durationMs < 1_000) return `${record.durationMs} ms`;
  return `${(record.durationMs / 1_000).toFixed(record.durationMs < 10_000 ? 1 : 0)} s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function getTimestampMs(isoString?: string): number {
  if (!isoString) return 0;
  const parsed = Date.parse(isoString);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function formatDateTime(isoString?: string): string {
  if (!isoString) return "—";
  const date = new Date(isoString);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export function formatTime(isoString?: string): string {
  if (!isoString) return "—";
  const date = new Date(isoString);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString();
}

/** The value JSON text holds; undefined when it is not JSON (JSON.parse never returns undefined). */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Strings (tool output previews) are shown as-is, pretty-printed when they
 * hold JSON, rather than re-encoded into one escaped line. */
export function formatJsonValue(value: unknown): string | undefined {
  if (typeof value !== "string") return JSON.stringify(value, null, 2);
  const parsed = parseJson(value);
  return parsed !== null && typeof parsed === "object" ? JSON.stringify(parsed, null, 2) : value;
}
