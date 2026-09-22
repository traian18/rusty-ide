import { beforeEach, describe, expect, it, vi } from "vitest";

import { commandPermissionService, type CommandPermissionRequest } from "./commandPermissionService";

function request(overrides: Partial<CommandPermissionRequest> = {}): CommandPermissionRequest {
  return {
    requestId: overrides.requestId ?? `req-${Math.random().toString(36).slice(2)}`,
    sessionId: "tab-1",
    command: { program: "grep", args: ["-r", "foo", "."], cwd: "/workspace", timeoutMs: 5_000 },
    risk: "normal",
    sessionGrantScope: "executable",
    sessionGrantProgram: "grep",
    description: "The agent wants to run: grep -r foo .",
    ...overrides,
  };
}

async function settled<T>(promise: Promise<T>): Promise<{ done: true; value: T } | { done: false }> {
  const marker = Symbol("pending");
  const result = await Promise.race([promise, Promise.resolve(marker)]);
  return result === marker ? { done: false } : { done: true, value: result as T };
}

describe("commandPermissionService session grants", () => {
  beforeEach(() => {
    // Drain any dialog a previous test left queued, and forget its grants.
    for (const sessionId of ["tab-1", "tab-2"]) commandPermissionService.clearSession(sessionId);
    let pending = commandPermissionService.getSnapshot();
    while (pending) {
      commandPermissionService.resolve(pending.requestId, "deny");
      pending = commandPermissionService.getSnapshot();
    }
  });

  it("queues a request the session has no grant for, and resolves it with the user's decision", async () => {
    const signal = new AbortController().signal;
    const decision = commandPermissionService.request(request({ requestId: "r1" }), signal);
    expect(commandPermissionService.getSnapshot()?.requestId).toBe("r1");
    expect(await settled(decision)).toEqual({ done: false });

    commandPermissionService.resolve("r1", "allow_once");
    expect(await decision).toBe("allow_once");
    expect(commandPermissionService.getSnapshot()).toBeNull();
  });

  it("allow_once does not create a grant -- the same command asks again", async () => {
    const signal = new AbortController().signal;
    const first = commandPermissionService.request(request({ requestId: "r1" }), signal);
    commandPermissionService.resolve("r1", "allow_once");
    await first;

    const second = commandPermissionService.request(request({ requestId: "r2" }), signal);
    expect(commandPermissionService.getSnapshot()?.requestId).toBe("r2");
    expect(await settled(second)).toEqual({ done: false });
  });

  it("allow_session on an executable-scoped request auto-approves other invocations of the same executable without a dialog", async () => {
    const signal = new AbortController().signal;
    const listener = vi.fn();
    const first = commandPermissionService.request(request({ requestId: "r1" }), signal);
    commandPermissionService.resolve("r1", "allow_session");
    expect(await first).toBe("allow_session");

    const unsubscribe = commandPermissionService.subscribe(listener);
    const second = commandPermissionService.request(
      request({ requestId: "r2", command: { program: "grep", args: ["-n", "other pattern", "src"], cwd: "/workspace", timeoutMs: 9_000 } }),
      signal,
    );
    expect(await second).toBe("allow_session");
    expect(commandPermissionService.getSnapshot()).toBeNull();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("an executable grant does not cover an exact_command-scoped request for the same program", async () => {
    const signal = new AbortController().signal;
    const first = commandPermissionService.request(request({ requestId: "r1" }), signal);
    commandPermissionService.resolve("r1", "allow_session");
    await first;

    // e.g. the policy escalated this variant to exact-command scope.
    const escalated = commandPermissionService.request(
      request({ requestId: "r2", risk: "elevated", sessionGrantScope: "exact_command" }),
      signal,
    );
    expect(commandPermissionService.getSnapshot()?.requestId).toBe("r2");
    expect(await settled(escalated)).toEqual({ done: false });
  });

  it("allow_session on an exact_command-scoped request covers only the identical program/args/cwd", async () => {
    const signal = new AbortController().signal;
    const exact = (requestId: string, args: string[]) =>
      request({
        requestId,
        risk: "elevated",
        sessionGrantScope: "exact_command",
        sessionGrantProgram: "npm",
        command: { program: "npm", args, cwd: "/workspace", timeoutMs: 5_000 },
      });
    const first = commandPermissionService.request(exact("r1", ["test"]), signal);
    commandPermissionService.resolve("r1", "allow_session");
    await first;

    expect(await commandPermissionService.request(exact("r2", ["test"]), signal)).toBe("allow_session");

    const changed = commandPermissionService.request(exact("r3", ["test", "--watch"]), signal);
    expect(commandPermissionService.getSnapshot()?.requestId).toBe("r3");
    expect(await settled(changed)).toEqual({ done: false });
  });

  it("grants are per session -- another tab asks again", async () => {
    const signal = new AbortController().signal;
    const first = commandPermissionService.request(request({ requestId: "r1", sessionId: "tab-1" }), signal);
    commandPermissionService.resolve("r1", "allow_session");
    await first;

    const otherTab = commandPermissionService.request(request({ requestId: "r2", sessionId: "tab-2" }), signal);
    expect(commandPermissionService.getSnapshot()?.requestId).toBe("r2");
    expect(await settled(otherTab)).toEqual({ done: false });
  });

  it("clearSession forgets the session's grants", async () => {
    const signal = new AbortController().signal;
    const first = commandPermissionService.request(request({ requestId: "r1" }), signal);
    commandPermissionService.resolve("r1", "allow_session");
    await first;
    expect(commandPermissionService.hasSessionGrant(request())).toBe(true);

    commandPermissionService.clearSession("tab-1");
    expect(commandPermissionService.hasSessionGrant(request())).toBe(false);
    const again = commandPermissionService.request(request({ requestId: "r2" }), signal);
    expect(commandPermissionService.getSnapshot()?.requestId).toBe("r2");
    expect(await settled(again)).toEqual({ done: false });
  });

  it("deny never creates a grant", async () => {
    const signal = new AbortController().signal;
    const first = commandPermissionService.request(request({ requestId: "r1" }), signal);
    commandPermissionService.resolve("r1", "deny");
    expect(await first).toBe("deny");
    expect(commandPermissionService.hasSessionGrant(request())).toBe(false);
  });

  it("aborting the signal withdraws a queued request without answering it", async () => {
    const controller = new AbortController();
    const pending = commandPermissionService.request(request({ requestId: "r1" }), controller.signal);
    expect(commandPermissionService.getSnapshot()?.requestId).toBe("r1");
    controller.abort();
    expect(commandPermissionService.getSnapshot()).toBeNull();
    expect(await settled(pending)).toEqual({ done: false });
  });
});
