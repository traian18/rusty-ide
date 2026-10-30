/** Describing how current the displayed snapshot is, without scanning anything. */

export type FreshnessState = "none" | "fresh" | "stale";

export interface FreshnessReport {
  state: FreshnessState;
  /** Files modified or removed since the snapshot was built. */
  changedCount: number;
  missingCount: number;
  /** "just now", "3 min ago", ... or null when nothing has been built. */
  builtAgo: string | null;
}

export function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function describeFreshness(
  builtAtMs: number | null,
  nowMs: number,
  changed: readonly string[],
  missing: readonly string[],
): FreshnessReport {
  if (builtAtMs === null) return { state: "none", changedCount: 0, missingCount: 0, builtAgo: null };
  const stale = changed.length > 0 || missing.length > 0;
  return {
    state: stale ? "stale" : "fresh",
    changedCount: changed.length,
    missingCount: missing.length,
    builtAgo: formatAge(nowMs - builtAtMs),
  };
}

/** "4 files changed, 1 removed since" for the toolbar; empty when nothing changed. */
export function staleSummary(report: FreshnessReport): string {
  const parts: string[] = [];
  if (report.changedCount) parts.push(`${report.changedCount} file${report.changedCount === 1 ? "" : "s"} changed`);
  if (report.missingCount) parts.push(`${report.missingCount} removed`);
  return parts.length ? `${parts.join(", ")} since` : "";
}
