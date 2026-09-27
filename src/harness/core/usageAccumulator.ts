import type { TokenUsage } from "../contract";

const FIELDS = ["totalTokens", "input", "output", "cacheRead", "cacheWrite", "reasoning"] as const;

/** rusty-core's `UsageUpdated` is a snapshot of the *current model request*:
 * a provider may report several per request (Anthropic sends one at
 * `message_start` and a running total at `message_delta`), and the next
 * request starts again from zero. `metrics.total_requests` counts completed
 * requests, so it is constant while one request streams -- together with
 * the agent id it identifies the request a snapshot belongs to. */
export function usageRequestKey(snapshot: unknown): string {
  const record = snapshot && typeof snapshot === "object" ? snapshot as { agent_id?: unknown; metrics?: { total_requests?: unknown } } : {};
  const requests = record.metrics?.total_requests;
  const count = typeof requests === "number" ? requests : Array.isArray(requests) ? requests[0] : String(requests ?? "");
  return `${String(record.agent_id ?? "")}:${count}`;
}

/** Turns per-request usage snapshots into (a) the increment each snapshot
 * adds, for append-only metrics, and (b) the running total across every
 * request, for "usage so far" displays -- so neither double-counts a
 * request's repeated snapshots nor forgets earlier requests. */
export class UsageAccumulator {
  private latest = new Map<string, TokenUsage>();

  /** `newRequest` is true for the first snapshot of a request. */
  apply(key: string, snapshot: TokenUsage): { delta: TokenUsage; total: TokenUsage; newRequest: boolean } {
    const newRequest = !this.latest.has(key);
    const previous = this.latest.get(key) ?? {};
    const delta: TokenUsage = {};
    for (const field of FIELDS) {
      const value = snapshot[field];
      if (value === undefined) continue;
      delta[field] = Math.max(0, value - (previous[field] ?? 0));
    }
    this.latest.set(key, { ...previous, ...Object.fromEntries(FIELDS.filter((f) => snapshot[f] !== undefined).map((f) => [f, snapshot[f]])) });
    return { delta, total: this.total(), newRequest };
  }

  total(): TokenUsage {
    const total: TokenUsage = {};
    for (const usage of this.latest.values()) {
      for (const field of FIELDS) {
        if (usage[field] !== undefined) total[field] = (total[field] ?? 0) + usage[field]!;
      }
    }
    return total;
  }
}

export function hasTokens(usage: TokenUsage): boolean {
  return FIELDS.some((field) => (usage[field] ?? 0) > 0);
}

function count(value: unknown): number | undefined {
  if (typeof value === "number" && !isNaN(value)) return value;
  if (Array.isArray(value) && typeof value[0] === "number") return value[0];
  if (value && typeof value === "object") {
    const raw = (value as Record<string, unknown>)[0] ?? (value as Record<string, unknown>).value;
    if (typeof raw === "number" && !isNaN(raw)) return raw;
  }
  return undefined;
}

function toTokenUsage(fields: Record<string, unknown>): TokenUsage {
  const input = count(fields.input_tokens);
  const output = count(fields.output_tokens);
  const reasoning = count(fields.reasoning_tokens);
  return {
    totalTokens: count(fields.total_tokens) ?? (input !== undefined || output !== undefined ? (input ?? 0) + (output ?? 0) : undefined),
    input,
    output,
    cacheRead: count(fields.cache_read_tokens),
    cacheWrite: count(fields.cache_write_tokens),
    ...(reasoning !== undefined ? { reasoning } : {}),
  };
}

/** rusty-core `UsageUpdated.usage` (an `AgentUsageSnapshot`) -> TokenUsage. */
export function mapAgentUsage(snapshot: unknown): TokenUsage {
  const metrics = snapshot && typeof snapshot === "object" ? (snapshot as { metrics?: unknown }).metrics : undefined;
  return toTokenUsage(metrics && typeof metrics === "object" ? metrics as Record<string, unknown> : {});
}

/** An `ExecutionProtocol` `ModelUsage` (one request's usage) -> TokenUsage. */
export function mapModelUsage(usage: unknown): TokenUsage {
  return toTokenUsage(usage && typeof usage === "object" ? usage as Record<string, unknown> : {});
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  const sum: TokenUsage = { ...a };
  for (const field of FIELDS) {
    if (b[field] !== undefined) sum[field] = (sum[field] ?? 0) + b[field]!;
  }
  return sum;
}
