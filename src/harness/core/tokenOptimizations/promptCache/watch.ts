// ============================================================
// promptCache/watch.ts -- how well one run's requests used the prompt
// cache, request by request.
//
// Every request of an agent resends the previous request's prompt plus a
// little more, so a follow-up request should read about the whole previous
// prompt from the cache. One that reads less than half of it missed, and
// paid for that part again. The watch says why, in this order:
//   prefix   the system prompt or tools changed (rusty-core reports it)
//   expired  more than five minutes passed, the default cache lifetime
//   history  anything else: earlier turns were rewritten (compaction,
//            trimming, replaced reads) or the provider dropped the cache
// A request whose provider reports no cache reads is counted, not judged.
//
// Providers count input differently: Anthropic's input excludes cached
// tokens and it reports cache writes; OpenAI and Gemini include them in
// input and report no writes. The prompt size uses whichever applies.
// ============================================================

import type { TokenUsage } from "../../../contract";

/** Below this many prompt tokens providers cache nothing. */
export const MIN_CACHEABLE_TOKENS = 1024;
/** The default prompt-cache lifetime (Anthropic's; OpenAI's is about the same). */
export const CACHE_LIFETIME_MS = 5 * 60 * 1000;
/** A follow-up reading less than this share of the previous prompt missed. */
export const MISS_SHARE = 0.5;

export type MissCause = "prefix" | "expired" | "history";

/** One finished request, as the statistics count it. */
export interface CachedRequest {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  /** Not the agent's first request, so it could have read from the cache. */
  followUp: boolean;
  /** Set on a follow-up that missed. */
  miss?: MissCause;
  /** The provider reported no cache reads, so the request was not judged. */
  unreported: boolean;
}

interface Pending {
  key: string;
  usage: TokenUsage;
  startedAt: number;
  lastAt: number;
  /** The prompt size of the agent's request before this one. */
  previousPrompt?: number;
  previousEndedAt?: number;
  prefixChanged: boolean;
}

/** A request's whole prompt, cached or not. */
export function promptTokens(usage: TokenUsage): number {
  const input = usage.input ?? 0;
  return usage.cacheWrite !== undefined ? input + (usage.cacheRead ?? 0) + usage.cacheWrite : input;
}

export function judge(pending: Pending): CachedRequest {
  const { usage } = pending;
  const followUp = pending.previousPrompt !== undefined;
  const unreported = usage.cacheRead === undefined;
  const request: CachedRequest = { input: usage.input ?? 0, cacheRead: usage.cacheRead ?? 0, cacheWrite: usage.cacheWrite ?? 0, followUp, unreported };
  const previous = pending.previousPrompt ?? 0;
  if (!followUp || unreported || previous < MIN_CACHEABLE_TOKENS || request.cacheRead >= previous * MISS_SHARE) return request;
  const gap = pending.startedAt - (pending.previousEndedAt ?? pending.startedAt);
  return { ...request, miss: pending.prefixChanged ? "prefix" : gap > CACHE_LIFETIME_MS ? "expired" : "history" };
}

/** One run's watch. Feed it every usage snapshot and prefix change; it hands each request to `record` once the request is over. */
export class PromptCacheWatch {
  private readonly agents = new Map<string, Pending>();
  private readonly prefixChanged = new Set<string>();

  constructor(private readonly record: (request: CachedRequest) => void, private readonly now: () => number = Date.now) {}

  /** rusty-core's `PromptPrefixChanged` for `agentId`: it comes before that request's usage. */
  prefixChange(agentId: string): void {
    this.prefixChanged.add(agentId);
  }

  /** A usage snapshot of `agentId`'s current request, identified by `requestKey`. */
  usage(agentId: string, requestKey: string, usage: TokenUsage): void {
    const at = this.now();
    const current = this.agents.get(agentId);
    if (current?.key === requestKey) {
      current.usage = { ...current.usage, ...usage };
      current.lastAt = at;
      return;
    }
    if (current) this.record(judge(current));
    this.agents.set(agentId, {
      key: requestKey,
      usage,
      startedAt: at,
      lastAt: at,
      previousPrompt: current ? promptTokens(current.usage) : undefined,
      previousEndedAt: current?.lastAt,
      prefixChanged: this.prefixChanged.delete(agentId),
    });
  }

  /** `agentId` finished (completed or failed): its last request is over. */
  endAgent(agentId: string): void {
    const pending = this.agents.get(agentId);
    if (pending) this.record(judge(pending));
    this.agents.delete(agentId);
    this.prefixChanged.delete(agentId);
  }
}
