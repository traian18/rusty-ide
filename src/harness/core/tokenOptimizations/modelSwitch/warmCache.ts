// ============================================================
// modelSwitch/warmCache.ts -- whether a running conversation may move to
// another model.
//
// A prompt cache belongs to one model. Once a conversation is cached,
// switching models makes the next request pay the whole conversation
// again at full price, where staying would have paid about a tenth of it.
// A cheaper model is never cheap enough to win that back (Haiku is about
// a fifth of Opus, not a tenth), so a switch to a cheaper model on a warm
// cache is refused. A switch to a more capable model is allowed: it is
// made for a better answer, not to save money, and the verdict says what
// it costs. A conversation below the smallest cacheable prompt has
// nothing cached, and any switch is free.
// ============================================================

/** Below this many prompt tokens providers cache nothing (Anthropic's and OpenAI's minimum). */
export const MIN_CACHEABLE_TOKENS = 1024;

export interface ModelSwitch {
  /** Toward a more capable model, a less capable one, or unknown (a different model either way). */
  direction: "up" | "down" | "unknown";
  /** The conversation already has model turns (so its prefix may be cached). */
  hasModelTurns: boolean;
  /** Estimated tokens of the conversation so far; unknown counts as cacheable. */
  conversationTokens?: number;
}

export interface ModelSwitchVerdict {
  allowed: boolean;
  /** One sentence for the log or a trace. */
  reason: string;
}

export function judgeModelSwitch(change: ModelSwitch): ModelSwitchVerdict {
  const tokens = change.conversationTokens;
  const warm = change.hasModelTurns && (tokens === undefined || tokens >= MIN_CACHEABLE_TOKENS);
  if (!warm) return { allowed: true, reason: "Nothing is cached yet, so switching models costs nothing extra." };
  const size = tokens === undefined ? "the cached conversation" : `about ${tokens.toLocaleString("en-US")} cached prompt tokens`;
  if (change.direction === "up") return { allowed: true, reason: `Switching to a more capable model re-reads ${size} once at the new model's full price.` };
  return { allowed: false, reason: `Kept the current model: switching would re-read ${size} at full price, which no cheaper model wins back.` };
}

/** Rough prompt tokens of a request's messages (4 characters a token). */
export const estimateConversationTokens = (messages: readonly unknown[]): number => Math.ceil(JSON.stringify(messages).length / 4);
