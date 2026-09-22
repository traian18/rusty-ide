/** Frontend broker for command approvals, requested by any harness backend. */

// Moved to shared/agent-protocol/rpc.ts (PR 4c) so both the client and the
// sidecar share one definition; re-exported here unchanged so existing
// importers of this module are unaffected.
export type {
  CommandPermissionDecision,
  CommandRisk,
  CommandSessionGrantScope,
  CommandPermissionRequest,
} from "../../shared/agent-protocol";
import type { CommandPermissionDecision, CommandPermissionRequest } from "../../shared/agent-protocol";
import { commandGrantKey } from "../harness/commandPolicy";

type PendingPermission = CommandPermissionRequest & {
  resolve: (decision: CommandPermissionDecision) => void;
};
type Listener = () => void;

class CommandPermissionService {
  private queue: PendingPermission[] = [];
  private listeners = new Set<Listener>();
  /**
   * Session grant memory, keyed by `CommandPermissionRequest.sessionId`
   * (the agent tab id for agent_chat) -> the set of `commandGrantKey`s the
   * user has already answered "allow this session" for. Held only in
   * memory, deliberately: a grant dies with the tab (see `clearSession`)
   * and never survives a restart. Ported IDE-side from the removed
   * sidecar's commandPermissions.ts (HARNESS_CONTRACT_PLAN.md decision 4).
   */
  private grants = new Map<string, Set<string>>();

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): CommandPermissionRequest | null => this.queue[0] || null;

  /**
   * Requests a decision from the user for `message`. Resolves once the user
   * answers (via `resolve()`, driven by CommandPermissionPresenter.tsx) --
   * or immediately with "allow_session", without showing any dialog, when
   * the session already holds a grant covering this command (an earlier
   * "allow this session" answer whose `commandGrantKey` matches: the same
   * executable for a normal-risk direct program, or the identical
   * program/args/cwd for everything else -- see harness/commandPolicy.ts).
   *
   * If `signal` aborts first (the run was cancelled or reached a terminal
   * outcome -- see the harness contract's RunHost), the request is
   * withdrawn from the queue and the dialog it was showing disappears; the
   * returned promise never settles in that case, matching contract/host.ts's
   * rule that a harness backend does not await requestPermission() past
   * abort, so an unsettled promise here is never awaited by anything.
   *
   * Replaces the previous enqueue(message, socket) + removeForSocket(socket)
   * pair (PR 4b-era, one real WebSocket-shaped facade per capability
   * service) with a single promise-returning call -- see
   * HARNESS_CONTRACT_PLAN.md Milestone A3.
   */
  request(message: CommandPermissionRequest, signal: AbortSignal): Promise<CommandPermissionDecision> {
    if (this.hasSessionGrant(message)) return Promise.resolve("allow_session");
    return new Promise((resolve) => {
      const entry: PendingPermission = { ...message, resolve };
      this.queue.push(entry);
      this.emit();
      signal.addEventListener(
        "abort",
        () => {
          const next = this.queue.filter((candidate) => candidate !== entry);
          if (next.length === this.queue.length) return;
          this.queue = next;
          this.emit();
        },
        { once: true },
      );
    });
  }

  resolve(requestId: string, decision: CommandPermissionDecision): void {
    const request = this.queue.find((candidate) => candidate.requestId === requestId);
    if (!request) return;
    this.queue = this.queue.filter((candidate) => candidate.requestId !== requestId);
    this.emit();
    if (decision === "allow_session") this.grantForSession(request);
    request.resolve(decision);
  }

  /** Whether `request` is already covered by an earlier "allow this
   * session" answer in the same session. */
  hasSessionGrant(request: CommandPermissionRequest): boolean {
    return this.grants.get(request.sessionId)?.has(commandGrantKey(request.command, request.sessionGrantScope)) ?? false;
  }

  /** Forgets every grant held for `sessionId` -- called when the agent tab
   * that owns the session closes, the replacement for the sidecar's
   * `command_session_close` message. Pending dialogs are untouched: they
   * belong to a run, and a run's own abort signal withdraws them. */
  clearSession(sessionId: string): void {
    this.grants.delete(sessionId);
  }

  private grantForSession(request: CommandPermissionRequest): void {
    const grants = this.grants.get(request.sessionId) ?? new Set<string>();
    grants.add(commandGrantKey(request.command, request.sessionGrantScope));
    this.grants.set(request.sessionId, grants);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const commandPermissionService = new CommandPermissionService();
