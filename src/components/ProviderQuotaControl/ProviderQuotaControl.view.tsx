import React from "react";
import {
  Activity,
  AlertCircle,
  ChevronDown,
  ExternalLink,
  Loader2,
  RefreshCw,
} from "lucide-react";
import type { CustomProvider, ProviderQuotaSnapshot } from "../../store";
import type { Option } from "../CustomSelect";
import { CustomSelect } from "../CustomSelect";
import { QuotaWindowRow } from "./QuotaWindowRow";
import { formatResetTimestamp, getQuotaSummary } from "./helpers";

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

interface DropdownPanelProps {
  selectedProvider: CustomProvider;
  selectedQuota: ProviderQuotaSnapshot | undefined;
  selectedError: string | undefined;
  loading: boolean;
  providerOptions: Option[];
  onProviderChange: (providerId: string) => void;
  onRefresh: () => void;
  onOpenManageUrl: () => void;
}

function DropdownPanel({
  selectedProvider,
  selectedQuota,
  selectedError,
  loading,
  providerOptions,
  onProviderChange,
  onRefresh,
  onOpenManageUrl,
}: DropdownPanelProps) {
  return (
    <div
      role="dialog"
      aria-label="Provider subscription quota"
      className="absolute right-0 top-[calc(100%+6px)] z-50 w-[360px] overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-sidebar)] shadow-2xl"
    >
      <DropdownHeader
        selectedProviderId={selectedProvider.id}
        providerOptions={providerOptions}
        loading={loading}
        onProviderChange={onProviderChange}
        onRefresh={onRefresh}
      />
      <DropdownBody
        selectedProvider={selectedProvider}
        selectedQuota={selectedQuota}
        selectedError={selectedError}
        loading={loading}
        onOpenManageUrl={onOpenManageUrl}
      />
      <DropdownFooter quota={selectedQuota} />
    </div>
  );
}

interface DropdownHeaderProps {
  selectedProviderId: string;
  providerOptions: Option[];
  loading: boolean;
  onProviderChange: (id: string) => void;
  onRefresh: () => void;
}

function DropdownHeader({
  selectedProviderId,
  providerOptions,
  loading,
  onProviderChange,
  onRefresh,
}: DropdownHeaderProps) {
  return (
    <div className="flex items-center gap-2 border-b border-[var(--border-color)] p-3">
      <Activity size={14} className="shrink-0 text-[var(--accent-color)]" />
      <CustomSelect
        value={selectedProviderId}
        onChange={onProviderChange}
        options={providerOptions}
        className="min-w-0 flex-1"
        direction="down"
      />
      <button
        type="button"
        onClick={onRefresh}
        disabled={loading}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border-color)] text-[var(--text-muted)] hover:border-[var(--accent-color)] hover:text-[var(--text-light)] disabled:opacity-50"
        title="Refresh quota"
        aria-label="Refresh quota"
      >
        <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
      </button>
    </div>
  );
}

interface DropdownBodyProps {
  selectedProvider: CustomProvider;
  selectedQuota: ProviderQuotaSnapshot | undefined;
  selectedError: string | undefined;
  loading: boolean;
  onOpenManageUrl: () => void;
}

function DropdownBody({
  selectedProvider,
  selectedQuota,
  selectedError,
  loading,
  onOpenManageUrl,
}: DropdownBodyProps) {
  return (
    <div className="max-h-[430px] space-y-3 overflow-y-auto p-3">
      <PlanBadge quota={selectedQuota} providerName={selectedProvider.name} />
      <ErrorMessage message={selectedError} />
      <LoadingIndicator visible={loading && !selectedQuota && !selectedError} />
      <WindowList windows={selectedQuota?.windows} />
      <CreditBalance balance={selectedQuota?.balance} />
      <ResetCredits available={selectedQuota?.resetCreditsAvailable} />
      <QuotaMessage message={selectedQuota?.message} />
      <ManageUrlButton url={selectedQuota?.manageUrl} onClick={onOpenManageUrl} />
    </div>
  );
}

function PlanBadge({
  quota,
  providerName,
}: {
  quota: ProviderQuotaSnapshot | undefined;
  providerName: string;
}) {
  if (!quota?.plan && !quota?.account) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[9px] text-[var(--text-muted)]">
      <span className="truncate">{quota.account || providerName}</span>
      {quota.plan && (
        <span className="rounded-full border border-[var(--accent-color)]/35 bg-[var(--accent-bg)]/15 px-2 py-0.5 font-bold text-[var(--text-light)]">
          {quota.plan}
        </span>
      )}
    </div>
  );
}

function ErrorMessage({ message }: { message: string | undefined }) {
  if (!message) return null;

  return (
    <div className="rounded-lg border border-[var(--color-status-danger)]/35 bg-[var(--color-status-danger)]/10 p-3 font-mono text-[9px] leading-relaxed text-[var(--text-normal)]">
      {message}
    </div>
  );
}

function LoadingIndicator({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <div className="flex items-center justify-center gap-2 py-8 font-mono text-[10px] text-[var(--text-muted)]">
      <Loader2 size={14} className="animate-spin text-[var(--accent-color)]" />
      Reading provider quota…
    </div>
  );
}

function WindowList({
  windows,
}: {
  windows: ProviderQuotaSnapshot["windows"] | undefined;
}) {
  if (!windows?.length) return null;

  return (
    <>
      {windows.map((window) => (
        <QuotaWindowRow key={window.id} window={window} />
      ))}
    </>
  );
}

function CreditBalance({
  balance,
}: {
  balance: ProviderQuotaSnapshot["balance"] | undefined;
}) {
  if (!balance) return null;

  return (
    <div className="flex items-center justify-between rounded-lg border border-[var(--border-color)]/70 bg-[var(--bg-app)]/70 p-2.5 font-mono">
      <span className="text-[9px] text-[var(--text-muted)]">Credit balance</span>
      <span className="text-[11px] font-bold text-[var(--text-light)]">
        {balance.unlimited ? "Unlimited" : balance.formatted}
      </span>
    </div>
  );
}

function ResetCredits({ available }: { available: number | undefined }) {
  if (available === undefined) return null;

  return (
    <div className="font-mono text-[9px] text-[var(--text-muted)]">
      Earned resets available:{" "}
      <span className="font-bold text-[var(--text-light)]">{available}</span>
    </div>
  );
}

function QuotaMessage({ message }: { message: string | undefined }) {
  if (!message) return null;

  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-app)]/60 p-3 font-mono text-[9px] leading-relaxed text-[var(--text-muted)]">
      {message}
    </div>
  );
}

function ManageUrlButton({
  url,
  onClick,
}: {
  url: string | undefined;
  onClick: () => void;
}) {
  if (!url) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 font-mono text-[9px] font-bold text-[var(--accent-color)] hover:underline"
    >
      <ExternalLink size={10} />
      Open provider usage
    </button>
  );
}

function DropdownFooter({
  quota,
}: {
  quota: ProviderQuotaSnapshot | undefined;
}) {
  if (!quota) return null;

  return (
    <div className="border-t border-[var(--border-color)] px-3 py-2 font-mono text-[8px] text-[var(--text-muted)]">
      Updated {formatResetTimestamp(quota.fetchedAt)} · {quota.source}
    </div>
  );
}
