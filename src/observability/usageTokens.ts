import type { ExecutionTokensSnapshot } from "./types";

const TOKEN_FIELDS = ["totalTokens", "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "reasoningTokens"] as const;

export function addTokens(target: ExecutionTokensSnapshot | undefined, delta: ExecutionTokensSnapshot): ExecutionTokensSnapshot {
  const sum: ExecutionTokensSnapshot = { ...target };
  for (const field of TOKEN_FIELDS) {
    if (delta[field] !== undefined) sum[field] = (sum[field] ?? 0) + delta[field]!;
  }
  return sum;
}

function countOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && !isNaN(value) ? value : undefined;
}

/** A count given as a number, or held at index `0` (a tuple) or `value`. */
function parseTokenCount(val: unknown): number | undefined {
  if (val && typeof val === "object") {
    const holder = val as Record<string, unknown>;
    return countOrUndefined(holder[0] ?? holder.value);
  }
  return countOrUndefined(val);
}

/** Normalizes any usage shape we receive (rusty-core `UsageUpdated`, with or
 * without its `metrics` wrapper, `ModelUsage`, or the IDE's camelCase
 * `TokenUsage`) into one snapshot. */
export function parseUsageTokens(usage: unknown): ExecutionTokensSnapshot {
  const outer = usage && typeof usage === "object" ? usage as Record<string, unknown> : {};
  const u = outer.metrics && typeof outer.metrics === "object" ? outer.metrics as Record<string, unknown> : outer;
  return {
    totalTokens: parseTokenCount(u.total_tokens ?? u.totalTokens ?? u.total),
    inputTokens: parseTokenCount(u.input_tokens ?? u.inputTokens ?? u.input),
    outputTokens: parseTokenCount(u.output_tokens ?? u.outputTokens ?? u.output),
    cacheReadTokens: parseTokenCount(u.cache_read_tokens ?? u.cacheReadTokens ?? u.cacheRead),
    cacheWriteTokens: parseTokenCount(u.cache_write_tokens ?? u.cacheWriteTokens ?? u.cacheWrite),
    reasoningTokens: parseTokenCount(u.reasoning_tokens ?? u.reasoningTokens ?? u.reasoning),
  };
}

export function definedTokens(tokens: ExecutionTokensSnapshot): ExecutionTokensSnapshot {
  return Object.fromEntries(Object.entries(tokens).filter(([, value]) => value !== undefined));
}
