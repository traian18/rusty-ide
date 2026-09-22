import React from "react";
import type { ProviderQuotaWindow } from "../../store";
import { formatNumber, formatResetTimestamp, getProgressColor, getWindowDisplayText } from "./helpers";

interface QuotaWindowRowProps {
  window: ProviderQuotaWindow;
}

/**
 * Displays a single quota window with a progress bar and metadata.
 */
export const QuotaWindowRow: React.FC<QuotaWindowRowProps> = ({ window }) => {
  const remaining = window.unlimited ? 100 : window.remainingPercent;
  const displayText = getWindowDisplayText(window);

  return (
    <div className="rounded-lg border border-[var(--border-color)]/70 bg-[var(--bg-app)]/70 p-2.5">
      <WindowHeader label={window.label} displayText={displayText} remaining={remaining} />
      {remaining !== undefined && <ProgressBar remaining={remaining} />}
      <WindowMetadata window={window} />
    </div>
  );
};

/* ── Sub-components ──────────────────────────────────────────────────────── */

interface WindowHeaderProps {
  label: string;
  displayText: string;
  remaining: number | undefined;
}

function WindowHeader({ label, displayText, remaining }: WindowHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="truncate font-mono text-[10px] font-bold text-[var(--text-light)]">
          {label}
        </div>
        <div className="mt-0.5 font-mono text-[9px] text-[var(--text-muted)]">
          {displayText}
        </div>
      </div>
      {remaining !== undefined && (
        <span className="shrink-0 font-mono text-[11px] font-bold text-[var(--text-light)]">
          {Math.round(remaining)}%
        </span>
      )}
    </div>
  );
}

function ProgressBar({ remaining }: { remaining: number }) {
  const clamped = Math.max(0, Math.min(100, remaining));
  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--border-color)]/70">
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{
          width: `${clamped}%`,
          backgroundColor: getProgressColor(remaining),
        }}
      />
    </div>
  );
}

function WindowMetadata({ window }: { window: ProviderQuotaWindow }) {
  const hasOverage = window.overage !== undefined && window.overage > 0;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[8px] text-[var(--text-muted)]">
      {window.resetAt && <span title={window.resetAt}>Resets {formatResetTimestamp(window.resetAt)}</span>}
      {hasOverage && <span>{formatNumber(window.overage!)} overage</span>}
      {window.overageAllowed && <span>Paid overage enabled</span>}
    </div>
  );
}
