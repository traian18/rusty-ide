import { describe, expect, it, vi } from "vitest";
import { NotificationCoordinator } from "./notificationCoordinator";
import type { NotificationPresenter, UserInteractionRequest } from "./notificationTypes";

function presenter(): NotificationPresenter & { respond: (requestId: string, actionId: string) => void } {
  const callbacks = new Map<string, (response: Parameters<NonNullable<NotificationPresenter["present"]>>[1] extends (value: infer V) => void ? V : never) => void>();
  const instance: NotificationPresenter & { respond: (requestId: string, actionId: string) => void } = {
    getCapabilities: () => ({ available: true, actionable: true, textInput: true }),
    present: async (request, callback) => { callbacks.set(request.requestId, callback); return "presented"; },
    presentPassive: async () => "presented",
    cancel: async (requestId) => { callbacks.delete(requestId); },
    dispose: () => callbacks.clear(),
    respond: (requestId, actionId) => callbacks.get(requestId)?.({ requestId, actionId, source: "in_app", respondedAt: Date.now() }),
  };
  return instance;
}

const request = (overrides: Partial<UserInteractionRequest> = {}): UserInteractionRequest => ({
  requestId: "request-1",
  kind: "permission",
  title: "Approve",
  body: "Run command",
  actions: [{ id: "allow", label: "Allow" }, { id: "deny", label: "Deny" }],
  createdAt: Date.now(),
  ...overrides,
});

describe("NotificationCoordinator", () => {
  it("registers and resolves once with a valid response", async () => {
    const p = presenter();
    const coordinator = new NotificationCoordinator({ presenters: [p] });
    const result = coordinator.register(request());
    expect(coordinator.getPending()).toHaveLength(1);
    await Promise.resolve();
    p.respond("request-1", "allow");
    await expect(result).resolves.toMatchObject({ requestId: "request-1", actionId: "allow" });
    expect(coordinator.getPending()).toHaveLength(0);
    expect(coordinator.respond({ requestId: "request-1", actionId: "deny", source: "in_app", respondedAt: Date.now() })).toBe(false);
  });

  it("ignores invalid actions", async () => {
    const p = presenter();
    const coordinator = new NotificationCoordinator({ presenters: [p] });
    const result = coordinator.register(request());
    expect(coordinator.respond({ requestId: "request-1", actionId: "bad", source: "in_app", respondedAt: Date.now() })).toBe(false);
    expect(coordinator.getPending()).toHaveLength(1);
    coordinator.cancel("request-1");
    await expect(result).rejects.toThrow("cancelled");
  });

  it("deduplicates and expires requests", async () => {
    vi.useFakeTimers();
    const coordinator = new NotificationCoordinator({ presenters: [presenter()], now: () => 1000 });
    const first = coordinator.register(request({ deduplicationKey: "same", expiresAt: 1100 }));
    await expect(coordinator.register(request({ requestId: "request-2", deduplicationKey: "same" }))).rejects.toThrow("Duplicate");
    vi.advanceTimersByTime(100);
    await expect(first).rejects.toThrow("expired");
    vi.useRealTimers();
  });
});
