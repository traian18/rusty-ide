import { describe, expect, it } from "vitest";

import type { CustomProvider } from "../store/types";
import { mapCodexQuota, mapCopilotQuota, mapManagedQuota } from "./managedQuota";

function provider(overrides: Partial<CustomProvider> = {}): CustomProvider {
  return { id: "github-copilot", name: "GitHub Copilot", baseUrl: "", apiKey: "", apiType: "openai-completions", models: [], ...overrides };
}

// Raw payloads below are the real responses observed live on 2026-09-18
// (identifying values replaced), so the mappers are pinned to what the
// CLIs actually return, not to what the sidecar's tests assumed.

describe("mapCopilotQuota", () => {
  const live = {
    authenticated: true,
    account: "octocat",
    plan: "individual",
    data: {
      quotaResetDate: "2026-10-01T00:00:00.000Z",
      quotaSnapshots: {
        chat: { isUnlimitedEntitlement: false, entitlementRequests: 200, usedRequests: 1, usageAllowedWithExhaustedQuota: false, overage: 0, overageAllowedWithExhaustedQuota: false, remainingPercentage: 99.8, resetDate: "2026-09-18T11:25:14.746Z" },
        completions: { isUnlimitedEntitlement: false, entitlementRequests: 2000, usedRequests: 0, usageAllowedWithExhaustedQuota: false, overage: 0, overageAllowedWithExhaustedQuota: false, remainingPercentage: 100, resetDate: "2026-09-18T11:25:14.746Z" },
        premium_interactions: { isUnlimitedEntitlement: false, entitlementRequests: 0, usedRequests: 0, usageAllowedWithExhaustedQuota: false, overage: 0, overageAllowedWithExhaustedQuota: false, remainingPercentage: 0, resetDate: "2026-09-18T11:25:14.746Z" },
      },
    },
  };

  it("orders the windows premium/chat/completions and uses the period reset date, not the snapshot timestamp", () => {
    const snapshot = mapCopilotQuota(provider(), live);
    expect(snapshot.state).toBe("available");
    expect(snapshot.source).toBe("github-copilot-cli");
    expect(snapshot.account).toBe("octocat");
    expect(snapshot.plan).toBe("individual");
    expect(snapshot.manageUrl).toBe("https://github.com/settings/copilot");
    expect(snapshot.windows.map((w) => w.id)).toEqual(["premium_interactions", "chat", "completions"]);
    const chat = snapshot.windows[1];
    expect(chat).toMatchObject({
      label: "Chat requests",
      used: 1,
      limit: 200,
      remaining: 199,
      remainingPercent: 99.8,
      unit: "requests",
      unlimited: false,
      overage: 0,
      overageAllowed: false,
      resetAt: "2026-10-01T00:00:00.000Z",
    });
    expect(chat.usedPercent).toBeCloseTo(0.2, 5);
  });

  it("falls back to the snapshot's own resetDate when no period reset is known", () => {
    const snapshot = mapCopilotQuota(provider(), { ...live, data: { quotaSnapshots: live.data.quotaSnapshots } });
    expect(snapshot.windows[1].resetAt).toBe("2026-09-18T11:25:14.746Z");
  });

  it("treats an unlimited entitlement as 100% remaining with no limit", () => {
    const snapshot = mapCopilotQuota(provider(), {
      authenticated: true,
      data: { quotaSnapshots: { chat: { isUnlimitedEntitlement: true, entitlementRequests: -1, usedRequests: 5, remainingPercentage: 0 } } },
    });
    expect(snapshot.windows[0]).toMatchObject({ unlimited: true, remainingPercent: 100, usedPercent: 0, limit: undefined, remaining: undefined, used: 5 });
  });

  it("is unauthenticated with the Rust-side message when not signed in", () => {
    const snapshot = mapCopilotQuota(provider(), { authenticated: false, message: "GitHub Copilot sign-in required" });
    expect(snapshot).toMatchObject({ state: "unauthenticated", message: "GitHub Copilot sign-in required", windows: [] });
  });

  it("is unavailable when signed in but no snapshots came back", () => {
    const snapshot = mapCopilotQuota(provider(), { authenticated: true, account: "octocat", data: { quotaSnapshots: {} } });
    expect(snapshot.state).toBe("unavailable");
    expect(snapshot.message).toMatch(/did not return quota snapshots/);
  });
});

describe("mapCodexQuota", () => {
  const codex = provider({ id: "openai-codex", name: "OpenAI Codex", transport: "openai-codex-app-server" });
  const live = {
    authenticated: true,
    account: "me@example.com",
    plan: "plus",
    data: {
      rateLimits: {
        limitId: "codex",
        primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: 1789748736 },
        secondary: { usedPercent: 39, windowDurationMins: 10080, resetsAt: 1789836917 },
        credits: { hasCredits: false, unlimited: false, balance: "0" },
        individualLimit: null,
        planType: "plus",
      },
      rateLimitResetCredits: { availableCount: 1 },
    },
  };

  it("maps the 5-hour and weekly windows, the credit balance, and reset credits", () => {
    const snapshot = mapCodexQuota(codex, live);
    expect(snapshot.state).toBe("available");
    expect(snapshot.plan).toBe("plus");
    expect(snapshot.account).toBe("me@example.com");
    expect(snapshot.windows).toEqual([
      { id: "primary", label: "5-hour limit", usedPercent: 0, remainingPercent: 100, resetAt: new Date(1789748736 * 1000).toISOString(), windowMinutes: 300 },
      { id: "secondary", label: "Weekly limit", usedPercent: 39, remainingPercent: 61, resetAt: new Date(1789836917 * 1000).toISOString(), windowMinutes: 10080 },
    ]);
    expect(snapshot.balance).toEqual({ formatted: "0", unlimited: false });
    expect(snapshot.resetCreditsAvailable).toBe(1);
    expect(snapshot.message).toBeUndefined();
  });

  it("maps a monthly spend limit when present", () => {
    const snapshot = mapCodexQuota(codex, { ...live, data: { rateLimits: { individualLimit: { limit: 100, used: 25, remainingPercent: 75, resetsAt: "2026-10-01T00:00:00Z" } } } });
    expect(snapshot.windows).toEqual([
      { id: "individual_limit", label: "Monthly spend limit", usedPercent: 25, remainingPercent: 75, used: 25, limit: 100, remaining: 75, unit: "credits", resetAt: "2026-10-01T00:00:00.000Z" },
    ]);
  });

  it("surfaces the Rust-side message for an auth method that reports no windows", () => {
    const snapshot = mapCodexQuota(codex, { authenticated: true, account: "me@example.com", message: "Codex is authenticated using apiKey; rate-limit windows are only reported for a ChatGPT sign-in." });
    expect(snapshot.state).toBe("unavailable");
    expect(snapshot.message).toMatch(/authenticated using apiKey/);
  });

  it("is unauthenticated when not signed in", () => {
    const snapshot = mapCodexQuota(codex, { authenticated: false, message: "Sign in with your OpenAI account to use your Codex plan." });
    expect(snapshot).toMatchObject({ state: "unauthenticated", manageUrl: "https://chatgpt.com/codex/settings/usage" });
  });
});

describe("mapManagedQuota", () => {
  it("dispatches by provider identity and rejects a non-managed provider", () => {
    expect(mapManagedQuota(provider(), { authenticated: false }).source).toBe("github-copilot-cli");
    expect(mapManagedQuota(provider({ id: "openai-codex" }), { authenticated: false }).source).toBe("openai-codex-app-server");
    expect(() => mapManagedQuota(provider({ id: "anthropic-claude-code" }), { authenticated: false })).toThrow(/not a managed-auth provider/);
    expect(() => mapManagedQuota(provider({ id: "openai" }), { authenticated: false })).toThrow(/not a managed-auth provider/);
  });
});
