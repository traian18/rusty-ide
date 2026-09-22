import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import type { CustomProvider } from "../store/types";
import { createHybridControlPlane } from "./HybridControlPlane";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

function provider(overrides: Partial<CustomProvider> = {}): CustomProvider {
  return {
    id: "opencode",
    name: "OpenCode Zen",
    baseUrl: "https://opencode.ai/zen/v1",
    apiKey: "sk-test",
    apiType: "openai-completions",
    models: [],
    ...overrides,
  };
}

describe("createHybridControlPlane", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("discoverModels() answers an HTTP-transport provider directly", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "big-pickle" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
    const hybridControlPlane = createHybridControlPlane();

    const models = await hybridControlPlane.discoverModels(provider());

    expect(models).toHaveLength(1);
  });

  it("discoverModels() rejects with a clear error for a managed transport (sidecar-removal Phase 8c: no fallback left)", async () => {
    const hybridControlPlane = createHybridControlPlane();
    const managed = provider({ id: "openai-codex", transport: "openai-codex-app-server" });

    await expect(hybridControlPlane.discoverModels(managed)).rejects.toThrow(/not available for managed-auth provider 'openai-codex'/);
  });

  it("discoverModels() rejects for a provider identified only by its managed id (no transport set)", async () => {
    const hybridControlPlane = createHybridControlPlane();
    const managed = provider({ id: "github-copilot", transport: undefined });

    await expect(hybridControlPlane.discoverModels(managed)).rejects.toThrow(/not available for managed-auth provider 'github-copilot'/);
  });

  it("testConnection() answers an HTTP-transport provider directly", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "big-pickle" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
    const hybridControlPlane = createHybridControlPlane();

    const result = await hybridControlPlane.testConnection(provider());

    expect(result.modelCount).toBe(1);
  });

  it("getQuota() answers an HTTP-transport provider directly (no network call)", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const hybridControlPlane = createHybridControlPlane();

    const snapshot = await hybridControlPlane.getQuota(provider({ id: "openai", name: "OpenAI" }));

    expect(snapshot.providerId).toBe("openai");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("getQuota() reads a managed provider's quota from managed_quota.rs and maps it", async () => {
    invokeMock.mockReset().mockResolvedValue({
      authenticated: true,
      account: "me@example.com",
      plan: "plus",
      data: { rateLimits: { primary: { usedPercent: 10, windowDurationMins: 300 } } },
    });
    const hybridControlPlane = createHybridControlPlane();
    const managed = provider({ id: "openai-codex", name: "OpenAI Codex", transport: "openai-codex-app-server" });

    const snapshot = await hybridControlPlane.getQuota(managed);

    expect(invokeMock).toHaveBeenCalledWith("managed_auth_quota", { provider: "codex" });
    expect(snapshot).toMatchObject({ providerId: "openai-codex", state: "available", plan: "plus", account: "me@example.com" });
    expect(snapshot.windows[0]).toMatchObject({ id: "primary", label: "5-hour limit", usedPercent: 10 });
  });

  it("getQuota() maps a managed provider by its well-known id even with no transport set", async () => {
    invokeMock.mockReset().mockResolvedValue({ authenticated: false, message: "GitHub Copilot sign-in required" });
    const hybridControlPlane = createHybridControlPlane();

    const snapshot = await hybridControlPlane.getQuota(provider({ id: "github-copilot", name: "GitHub Copilot" }));

    expect(invokeMock).toHaveBeenCalledWith("managed_auth_quota", { provider: "github-copilot" });
    expect(snapshot).toMatchObject({ state: "unauthenticated", message: "GitHub Copilot sign-in required" });
  });

  it("getQuota() surfaces a managed_quota.rs failure as a rejection", async () => {
    invokeMock.mockReset().mockRejectedValue("The claude-code CLI is not bundled with this build");
    const hybridControlPlane = createHybridControlPlane();

    await expect(hybridControlPlane.getQuota(provider({ id: "anthropic-claude-code" }))).rejects.toBe("The claude-code CLI is not bundled with this build");
  });

  it("getCopilotStatus()/startCopilotLogin()/logoutCopilot() call managed_auth.rs directly", async () => {
    invokeMock.mockReset().mockResolvedValue({ authenticated: true, message: "ok", verification_uri: null, user_code: null, in_progress: false });
    const hybridControlPlane = createHybridControlPlane();

    const status = await hybridControlPlane.getCopilotStatus();

    expect(invokeMock).toHaveBeenCalledWith("managed_auth_status", { provider: "github-copilot" });
    expect(status).toEqual({ state: "connected", authenticated: true, message: "ok", verificationUri: undefined, userCode: undefined });

    invokeMock.mockReset().mockResolvedValue(undefined);
    await hybridControlPlane.startCopilotLogin();
    expect(invokeMock).toHaveBeenCalledWith("managed_auth_start_login", { provider: "github-copilot" });

    invokeMock.mockReset().mockResolvedValue(undefined);
    await hybridControlPlane.logoutCopilot();
    expect(invokeMock).toHaveBeenCalledWith("managed_auth_logout", { provider: "github-copilot" });
  });

  it("getCodexStatus()/getClaudeCodeStatus() call managed_auth.rs with the right integration id", async () => {
    invokeMock.mockReset().mockResolvedValue({ authenticated: false, message: "", verification_uri: null, user_code: null, in_progress: false });
    const hybridControlPlane = createHybridControlPlane();

    await hybridControlPlane.getCodexStatus();
    expect(invokeMock).toHaveBeenCalledWith("managed_auth_status", { provider: "codex" });

    await hybridControlPlane.getClaudeCodeStatus();
    expect(invokeMock).toHaveBeenCalledWith("managed_auth_status", { provider: "claude-code" });
  });

  it("recordUsage() calls record_usage directly and unconditionally", async () => {
    invokeMock.mockReset().mockResolvedValue(undefined);
    const hybridControlPlane = createHybridControlPlane();

    await hybridControlPlane.recordUsage({
      workspaceRoot: "/workspace",
      surface: "agent_chat",
      runId: "run-1",
      model: "claude-opus",
      usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30 },
    });

    expect(invokeMock).toHaveBeenCalledWith("record_usage", {
      workspaceRoot: "/workspace",
      entry: {
        surface: "agent_chat",
        runId: "run-1",
        model: "claude-opus",
        usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30 },
      },
    });
  });
});
