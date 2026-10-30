import React from "react";
import {Activity, AlertCircle, ChevronDown, Loader2} from "lucide-react";
import type { CustomProvider, ProviderQuotaSnapshot } from "../../../../store";
import type { Option } from "../../../../lib/ui/CustomSelect";
import {getQuotaSummary} from "./helpers";
import { DropdownPanel } from "./QuotaDropdown";

interface ProviderQuotaControlViewProps {
  /** Currently selected provider (null when none configured). */
  selectedProvider: CustomProvider | null;
  /** Quota snapshot for the selected provider. */
  selectedQuota: ProviderQuotaSnapshot | undefined;
  /** Error message for the selected provider, if any. */
  selectedError: string | undefined;
  /** True while a quota fetch is in progress. */
  loading: boolean;
  /** Dropdown open state. */
  open: boolean;
  /** Options list for the provider dropdown. */
  providerOptions: Option[];
  /** Ref attached to the root element for outside-click detection. */
  rootRef: React.RefObject<HTMLDivElement | null>;
  /* ── Callbacks ──────────────────────────────────────────── */
  onToggleOpen: () => void;
  onProviderChange: (providerId: string) => void;
  onRefresh: () => void;
  onOpenManageUrl: () => void;
}

/**
 * Pure presentational component for the provider quota control.
 *
 * All state and effects live in the parent; this component only renders.
 */
export const ProviderQuotaControlView: React.FC<ProviderQuotaControlViewProps> = ({
  selectedProvider,
  selectedQuota,
  selectedError,
  loading,
  open,
  providerOptions,
  rootRef,
  onToggleOpen,
  onProviderChange,
  onRefresh,
  onOpenManageUrl,
}) => {
  if (!selectedProvider) return null;

  const summary = selectedError
    ? "Quota error"
    : getQuotaSummary(selectedQuota, loading);

  return (
    <div ref={rootRef} className="relative">
      <ToggleButton
        providerName={selectedProvider.name}
        summary={summary}
        loading={loading}
        hasError={!!selectedError}
        open={open}
        onToggle={onToggleOpen}
      />
      {open && (
        <DropdownPanel
          selectedProvider={selectedProvider}
          selectedQuota={selectedQuota}
          selectedError={selectedError}
          loading={loading}
          providerOptions={providerOptions}
          onProviderChange={onProviderChange}
          onRefresh={onRefresh}
          onOpenManageUrl={onOpenManageUrl}
        />
      )}
    </div>
  );
};

/* ── Sub-components ──────────────────────────────────────────────────────── */

interface ToggleButtonProps {
  providerName: string;
  summary: string;
  loading: boolean;
  hasError: boolean;
  open: boolean;
  onToggle: () => void;
}

function ToggleButton({
  providerName,
  summary,
  loading,
  hasError,
  open,
  onToggle,
}: ToggleButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex h-7 max-w-[250px] items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-sidebar)] px-2.5 text-left transition-colors hover:border-[var(--accent-color)]/45"
      aria-expanded={open}
      aria-haspopup="dialog"
      title={`${providerName}: ${summary}`}
    >
      <StatusIcon loading={loading} hasError={hasError} />
      <span className="max-w-[92px] truncate font-mono text-[9px] text-[var(--text-muted)]">
        {providerName}
      </span>
      <span className="truncate font-mono text-[9px] font-bold text-[var(--text-light)]">
        {summary}
      </span>
      <ChevronDown
        size={10}
        className={`ml-auto shrink-0 text-[var(--text-muted)] transition-transform ${open ? "rotate-180" : ""}`}
      />
    </button>
  );
}

function StatusIcon({ loading, hasError }: { loading: boolean; hasError: boolean }) {
  if (loading) {
    return <Loader2 size={12} className="shrink-0 animate-spin text-[var(--accent-color)]" />;
  }
  if (hasError) {
    return <AlertCircle size={12} className="shrink-0 text-[var(--color-status-danger)]" />;
  }
  return <Activity size={12} className="shrink-0 text-[var(--accent-color)]" />;
}

