// ============================================================
// FakeHarness.ts — A scriptable AgentHarness for tests.
//
// Not part of the contract itself (contract/ stays pure types); this is
// the shared test double both testing/contractTests.ts (proving the
// contract is coherent) and any consumer-side test (router.test.ts, a
// future component test) can drive without a real backend.
// ============================================================

import type {
  AgentHarness,
  CapabilityEvent,
  CapabilityInput,
  CapabilityName,
  RunHandle,
  RunHost,
  RunOutcome,
  TokenUsage,
} from "../contract";

interface ActiveRun<K extends CapabilityName> {
  capability: K;
  input: CapabilityInput<K>;
  host: RunHost;
  onEvent: (event: CapabilityEvent<K>) => void;
  controller: AbortController;
  resolveStarted: () => void;
  resolveDone: (outcome: RunOutcome<K>) => void;
  settled: boolean;
  cancelled: boolean;
}

export class FakeHarness implements AgentHarness {
  readonly id = "fake";

  private readonly runs = new Map<string, ActiveRun<CapabilityName>>();
  private nextRunId = 1;
  private readonly usageListeners = new Set<(runId: string, usage: TokenUsage) => void>();
  private readonly releasedSessions: string[] = [];
  private supportsOverride: ((capability: CapabilityName, input: unknown) => boolean) | undefined;

  /** Test hook: make `supports()` return false for a given predicate (e.g. to
   * exercise HarnessRouter's fallback). */
  setSupports(predicate: (capability: CapabilityName, input: unknown) => boolean): void {
    this.supportsOverride = predicate;
  }

  supports<K extends CapabilityName>(capability: K, input: CapabilityInput<K>): boolean {
    return this.supportsOverride ? this.supportsOverride(capability, input) : true;
  }

  run<K extends CapabilityName>(
    capability: K,
    input: CapabilityInput<K>,
    host: RunHost,
    onEvent: (event: CapabilityEvent<K>) => void,
  ): RunHandle<K> {
    const runId = `fake-${this.nextRunId++}`;
    const controller = new AbortController();
    let resolveStarted!: () => void;
    let resolveDone!: (outcome: RunOutcome<K>) => void;
    const started = new Promise<void>((resolve) => (resolveStarted = resolve));
    const done = new Promise<RunOutcome<K>>((resolve) => (resolveDone = resolve));

    const entry: ActiveRun<K> = {
      capability,
      input,
      host,
      onEvent,
      controller,
      resolveStarted,
      resolveDone: resolveDone as (outcome: RunOutcome<CapabilityName>) => void,
      settled: false,
      cancelled: false,
    };
    this.runs.set(runId, entry as unknown as ActiveRun<CapabilityName>);

    return {
      runId,
      started,
      done,
      cancel: () => {
        const active = this.runs.get(runId);
        if (!active || active.settled) return;
        active.cancelled = true;
        active.controller.abort();
        this.settle(runId, { status: "cancelled" });
      },
    };
  }

  subscribeUsage(listener: (runId: string, usage: TokenUsage) => void): () => void {
    this.usageListeners.add(listener);
    return () => this.usageListeners.delete(listener);
  }

  async releaseSession(sessionKey: string): Promise<void> {
    this.releasedSessions.push(sessionKey);
  }

  // --- test-only driver surface -------------------------------------------

  getReleasedSessions(): readonly string[] {
    return this.releasedSessions;
  }

  markStarted(runId: string): void {
    const active = this.runs.get(runId);
    if (!active) throw new Error(`FakeHarness: no active run ${runId}`);
    active.resolveStarted();
  }

  emit(runId: string, event: CapabilityEvent<CapabilityName>): void {
    const active = this.runs.get(runId);
    if (!active || active.settled) return;
    active.onEvent(event);
  }

  emitUsage(runId: string, usage: TokenUsage): void {
    for (const listener of this.usageListeners) listener(runId, usage);
  }

  /** Issues a host request and returns its settlement -- the caller decides
   * whether to await it (contractTests.ts uses this to prove read/write is
   * awaited in order while ask/permission is not). */
  requestRead(runId: string, path: string): Promise<string> {
    const active = this.mustGet(runId);
    return active.host.readFile(path, active.controller.signal);
  }

  requestWrite(runId: string, path: string, content: string): Promise<void> {
    const active = this.mustGet(runId);
    return active.host.writeFile(path, content, active.controller.signal);
  }

  requestPermission(runId: string, request: Parameters<RunHost["requestPermission"]>[0]) {
    const active = this.mustGet(runId);
    return active.host.requestPermission(request, active.controller.signal);
  }

  complete(runId: string, result: unknown): void {
    this.settle(runId, { status: "completed", result } as RunOutcome<CapabilityName>);
  }

  fail(runId: string, error: { code: string; message: string }): void {
    this.settle(runId, { status: "failed", error });
  }

  wasCancelled(runId: string): boolean {
    return this.mustGet(runId).cancelled;
  }

  private mustGet(runId: string): ActiveRun<CapabilityName> {
    const active = this.runs.get(runId);
    if (!active) throw new Error(`FakeHarness: no active run ${runId}`);
    return active;
  }

  private settle(runId: string, outcome: RunOutcome<CapabilityName>): void {
    const active = this.runs.get(runId);
    if (!active || active.settled) return;
    active.settled = true;
    active.resolveDone(outcome);
  }
}
