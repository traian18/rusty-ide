import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import {
  managedAuthCancelLogin,
  managedAuthLoginStatus,
  managedAuthLogout,
  managedAuthStartLogin,
  managedAuthStatus,
  managedAuthSubmitCode,
  type LoginState,
} from "./managedAuthClient";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

const state: LoginState = {
  authenticated: true,
  message: "Ready",
  verification_uri: null,
  user_code: null,
  in_progress: false,
};

describe("managedAuthClient", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("managedAuthStatus() invokes managed_auth_status with the provider", async () => {
    invokeMock.mockResolvedValue(state);
    const result = await managedAuthStatus("codex");
    expect(invokeMock).toHaveBeenCalledWith("managed_auth_status", { provider: "codex" });
    expect(result).toEqual(state);
  });

  it("managedAuthStartLogin() invokes managed_auth_start_login with the provider", async () => {
    invokeMock.mockResolvedValue(undefined);
    await managedAuthStartLogin("claude-code");
    expect(invokeMock).toHaveBeenCalledWith("managed_auth_start_login", { provider: "claude-code" });
  });

  it("managedAuthLoginStatus() invokes managed_auth_login_status with the provider", async () => {
    invokeMock.mockResolvedValue({ ...state, in_progress: true });
    const result = await managedAuthLoginStatus("github-copilot");
    expect(invokeMock).toHaveBeenCalledWith("managed_auth_login_status", { provider: "github-copilot" });
    expect(result.in_progress).toBe(true);
  });

  it("managedAuthLogout() invokes managed_auth_logout with the provider", async () => {
    invokeMock.mockResolvedValue(undefined);
    await managedAuthLogout("codex");
    expect(invokeMock).toHaveBeenCalledWith("managed_auth_logout", { provider: "codex" });
  });

  it("managedAuthSubmitCode() invokes managed_auth_submit_code with provider and code", async () => {
    invokeMock.mockResolvedValue(undefined);
    await managedAuthSubmitCode("claude-code", "auth_code#state_123");
    expect(invokeMock).toHaveBeenCalledWith("managed_auth_submit_code", {
      provider: "claude-code",
      code: "auth_code#state_123",
    });
  });

  it("managedAuthCancelLogin() invokes managed_auth_cancel_login with the provider", async () => {
    invokeMock.mockResolvedValue(undefined);
    await managedAuthCancelLogin("claude-code");
    expect(invokeMock).toHaveBeenCalledWith("managed_auth_cancel_login", {
      provider: "claude-code",
    });
  });
});
