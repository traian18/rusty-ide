// ============================================================
// modelLimits/lookup.ts -- a model's context limits from LiteLLM's catalog
// (see litellmSource.json), for a model whose provider lists none.
//
// The same model has different limits on different providers (a
// subscription often gets less than the API), so the provider's own entry
// wins: `<litellm provider>/<model>`, or a bare key LiteLLM files under that
// provider. Only then the maker's own entry, which a proxy serving the same
// model usually matches. Local servers (Ollama, vLLM) are never guessed:
// their window is whatever they were started with.
// ============================================================

import source from "./litellmSource.json";

/** `[input tokens, output tokens or null, LiteLLM provider]`, as the snapshot and the app's copy store them. */
export type LimitsEntry = [number, number | null, string];
export type LimitsEntries = Record<string, LimitsEntry>;

export interface ModelLimits {
  contextWindow: number;
  maxOutputTokens?: number;
  /** The catalog key the limits came from. */
  key: string;
}

const PROVIDERS = source.providers as Record<string, string[]>;
const VENDORS = new Set(source.vendors);
const LOCAL = new Set(source.local);

function limitsOf(entries: LimitsEntries, key: string, accept: (provider: string) => boolean): ModelLimits | undefined {
  const entry = entries[key];
  if (!entry || !accept(entry[2])) return undefined;
  const [input, output] = entry;
  return { contextWindow: input, ...(output ? { maxOutputTokens: output } : {}), key };
}

/** `model` is the provider's own id for it (the remote id, without Rusty's `<provider>/` prefix). */
export function lookupModelLimits(entries: LimitsEntries, providerId: string | undefined, model: string): ModelLimits | undefined {
  const id = model.trim().toLowerCase();
  if (!id || (providerId && LOCAL.has(providerId))) return undefined;
  for (const provider of (providerId && PROVIDERS[providerId]) || []) {
    const found = limitsOf(entries, `${provider}/${id}`, (filed) => filed === provider)
      ?? limitsOf(entries, id, (filed) => filed === provider);
    if (found) return found;
  }
  // The maker's entry: `claude-x`, or `anthropic/claude-x` as a router names it.
  const bare = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  return limitsOf(entries, bare, (filed) => VENDORS.has(filed))
    ?? [...VENDORS].map((vendor) => limitsOf(entries, `${vendor}/${bare}`, (filed) => filed === vendor)).find(Boolean);
}
