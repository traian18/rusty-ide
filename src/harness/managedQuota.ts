// ============================================================
// managedQuota.ts — Shapes a managed-auth provider's raw quota payload
// (managed_quota.rs's `ManagedQuota`, via managedAuthClient.ts's
// `managedAuthQuota`) into the store's `ProviderQuotaSnapshot`.
//
// The two mappers are the removed sidecar's own
// agent-sidecar/src/services/providerQuota.ts `mapCopilotQuota` /
// `mapCodexQuota`, ported verbatim -- the raw shapes they consume are
// unchanged (Copilot's SDK-style `AccountQuotaSnapshot`s come straight
// from the CLI's `account.getQuota`, Codex's `account/rateLimits/read`
// result). One deliberate difference: Copilot's per-snapshot `resetDate` is
// really the snapshot *timestamp* (observed live: every window's
// `resetDate` == now), so the period reset is taken from the user
// record's `quota_reset_date_utc` (`data.quotaResetDate`) first.
// ============================================================

import type { ManagedQuota } from "./managedAuthClient";
import type { CustomProvider, ProviderQuotaSnapshot, ProviderQuotaWindow } from "../store/types";
import { isCodexProvider, isCopilotProvider } from "../store/providerHelpers";

type Raw = Record<string, unknown>;

function asRecord(value: unknown): Raw {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : {};
}

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(number) ? number : undefined;
}

function percentage(value: unknown): number | undefined {
  const number = finiteNumber(value);
  if (number === undefined) return undefined;
  return Math.max(0, Math.min(100, number));
}

function isoDate(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
  }
  const seconds = finiteNumber(value);
  if (seconds === undefined) return undefined;
  const timestamp = seconds > 10_000_000_000 ? seconds : seconds * 1_000;
  return new Date(timestamp).toISOString();
}

function snapshotBase(provider: CustomProvider, source: string): Pick<ProviderQuotaSnapshot, "providerId" | "providerName" | "source" | "fetchedAt" | "windows"> {
  return {
    providerId: provider.id,
    providerName: provider.name,
    source,
    fetchedAt: new Date().toISOString(),
    windows: [],
  };
}

// ------------------------------------------------------------
// GitHub Copilot
// ------------------------------------------------------------

const COPILOT_QUOTA_ORDER = ["premium_interactions", "chat", "completions"];

function copilotQuotaLabel(id: string): string {
  if (id === "premium_interactions") return "Premium requests";
  if (id === "chat") return "Chat requests";
  if (id === "completions") return "Code completions";
  return id.replace(/[_-]+/g, " ").replace(/^./, (character) => character.toUpperCase());
}

export function mapCopilotQuota(provider: CustomProvider, quota: ManagedQuota): ProviderQuotaSnapshot {
  const base = snapshotBase(provider, "github-copilot-cli");
  if (!quota.authenticated) {
    return {
      ...base,
      state: "unauthenticated",
      message: quota.message || "Sign in with GitHub to read Copilot subscription quota.",
      manageUrl: "https://github.com/settings/copilot",
    };
  }

  const data = asRecord(quota.data);
  const snapshots = asRecord(data.quotaSnapshots);
  const periodReset = isoDate(data.quotaResetDate);
  const ids = Object.keys(snapshots).sort((left, right) => {
    const leftIndex = COPILOT_QUOTA_ORDER.indexOf(left);
    const rightIndex = COPILOT_QUOTA_ORDER.indexOf(right);
    return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
  });
  const windows = ids.flatMap((id): ProviderQuotaWindow[] => {
    const entry = snapshots[id];
    if (!entry || typeof entry !== "object") return [];
    const snapshot = entry as Raw;
    const unlimited = Boolean(snapshot.isUnlimitedEntitlement);
    const limit = finiteNumber(snapshot.entitlementRequests);
    const used = finiteNumber(snapshot.usedRequests);
    const remainingPercent = unlimited ? 100 : percentage(snapshot.remainingPercentage);
    return [{
      id,
      label: copilotQuotaLabel(id),
      usedPercent: remainingPercent === undefined ? undefined : 100 - remainingPercent,
      remainingPercent,
      used,
      limit: unlimited || limit === -1 ? undefined : limit,
      remaining: unlimited || limit === undefined || used === undefined ? undefined : Math.max(0, limit - used),
      unit: "requests",
      resetAt: periodReset ?? isoDate(snapshot.resetDate),
      unlimited,
      overage: finiteNumber(snapshot.overage),
      overageAllowed: Boolean(snapshot.overageAllowedWithExhaustedQuota || snapshot.usageAllowedWithExhaustedQuota),
    }];
  });

  return {
    ...base,
    state: windows.length ? "available" : "unavailable",
    plan: quota.plan,
    account: quota.account,
    windows,
    message: windows.length ? undefined : "GitHub did not return quota snapshots for this Copilot plan.",
    manageUrl: "https://github.com/settings/copilot",
  };
}

// ------------------------------------------------------------
// Codex
// ------------------------------------------------------------

function durationLabel(minutes: number | undefined, fallback: string): string {
  if (minutes === 300) return "5-hour limit";
  if (minutes === 10_080) return "Weekly limit";
  if (minutes && minutes % 1_440 === 0) return `${minutes / 1_440}-day limit`;
  if (minutes && minutes % 60 === 0) return `${minutes / 60}-hour limit`;
  return fallback;
}

function codexWindow(id: string, fallbackLabel: string, value: unknown): ProviderQuotaWindow | null {
  if (!value || typeof value !== "object") return null;
  const window = value as Raw;
  const usedPercent = percentage(window.usedPercent);
  const windowMinutes = finiteNumber(window.windowDurationMins);
  return {
    id,
    label: durationLabel(windowMinutes, fallbackLabel),
    usedPercent,
    remainingPercent: usedPercent === undefined ? undefined : 100 - usedPercent,
    resetAt: isoDate(window.resetsAt),
    windowMinutes,
  };
}

function codexSpendWindow(value: unknown): ProviderQuotaWindow | null {
  if (!value || typeof value !== "object") return null;
  const window = value as Raw;
  const limit = finiteNumber(window.limit);
  const used = finiteNumber(window.used);
  return {
    id: "individual_limit",
    label: "Monthly spend limit",
    usedPercent: limit && used !== undefined ? percentage((used / limit) * 100) : undefined,
    remainingPercent: percentage(window.remainingPercent),
    used,
    limit,
    remaining: limit === undefined || used === undefined ? undefined : Math.max(0, limit - used),
    unit: "credits",
    resetAt: isoDate(window.resetsAt),
  };
}

export function mapCodexQuota(provider: CustomProvider, quota: ManagedQuota): ProviderQuotaSnapshot {
  const base = snapshotBase(provider, "openai-codex-app-server");
  if (!quota.authenticated) {
    return {
      ...base,
      state: "unauthenticated",
      message: quota.message || "Sign in with OpenAI to read Codex subscription quota.",
      manageUrl: "https://chatgpt.com/codex/settings/usage",
    };
  }

  const result = asRecord(quota.data);
  const rateLimits = asRecord(result.rateLimits);
  const windows = [
    codexWindow("primary", "Primary limit", rateLimits.primary),
    codexWindow("secondary", "Secondary limit", rateLimits.secondary),
    codexSpendWindow(rateLimits.individualLimit),
  ].filter((window): window is ProviderQuotaWindow => Boolean(window));
  const credits = rateLimits.credits && typeof rateLimits.credits === "object" ? (rateLimits.credits as Raw) : undefined;
  const hasBalance = Boolean(credits && (credits.unlimited || credits.balance != null));
  const resetCreditsAvailable = finiteNumber(asRecord(result.rateLimitResetCredits).availableCount);
  const spendControlReached = typeof result.spendControlReached === "boolean" ? result.spendControlReached : undefined;
  const planType = typeof rateLimits.planType === "string" ? rateLimits.planType : undefined;

  return {
    ...base,
    state: windows.length || hasBalance ? "available" : "unavailable",
    plan: planType || quota.plan,
    account: quota.account,
    windows,
    balance: hasBalance && credits
      ? { formatted: credits.unlimited ? undefined : String(credits.balance), unlimited: Boolean(credits.unlimited) }
      : undefined,
    resetCreditsAvailable,
    spendControlReached,
    message: windows.length || hasBalance
      ? (spendControlReached ? "The account spending control has been reached." : undefined)
      : quota.message || "OpenAI did not return rate-limit windows for this Codex account.",
    manageUrl: "https://chatgpt.com/codex/settings/usage",
  };
}

// ------------------------------------------------------------
// Claude Code
// ------------------------------------------------------------

/** Picks the mapper by provider identity (same predicates
 * `HybridControlPlane`'s managed-provider detection uses). */
export function mapManagedQuota(provider: CustomProvider, quota: ManagedQuota): ProviderQuotaSnapshot {
  if (isCopilotProvider(provider)) return mapCopilotQuota(provider, quota);
  if (isCodexProvider(provider)) return mapCodexQuota(provider, quota);
  throw new Error(`mapManagedQuota: '${provider.id}' is not a managed-auth provider.`);
}
