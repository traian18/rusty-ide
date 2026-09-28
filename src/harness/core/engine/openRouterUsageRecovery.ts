import type { ModelUsage } from "./ExecutionProtocol";

interface PiUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
  totalTokens?: number;
}

interface OpenRouterGenerationData {
  native_tokens_prompt?: unknown;
  native_tokens_completion?: unknown;
  native_tokens_cached?: unknown;
  native_tokens_reasoning?: unknown;
  tokens_prompt?: unknown;
  tokens_completion?: unknown;
}

const RETRY_DELAYS_MS = [0, 150, 350] as const;
const REQUEST_TIMEOUT_MS = 2_000;

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function hasModelUsage(usage: ModelUsage): boolean {
  return [
    usage.input_tokens,
    usage.output_tokens,
    usage.cache_read_tokens,
    usage.cache_write_tokens,
    usage.reasoning_tokens,
    usage.total_tokens,
  ].some((value) => typeof value === "number" && value > 0);
}

function generationUsage(data: OpenRouterGenerationData): PiUsage | undefined {
  const prompt = tokenCount(data.native_tokens_prompt) ?? tokenCount(data.tokens_prompt);
  const output = tokenCount(data.native_tokens_completion) ?? tokenCount(data.tokens_completion);
  if (prompt === undefined && output === undefined) return undefined;

  const cacheRead = tokenCount(data.native_tokens_cached) ?? 0;
  const input = Math.max(0, (prompt ?? 0) - cacheRead);
  const completion = output ?? 0;
  return {
    input,
    output: completion,
    cacheRead,
    cacheWrite: 0,
    reasoning: tokenCount(data.native_tokens_reasoning) ?? 0,
    totalTokens: input + cacheRead + completion,
  };
}

function wait(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchGeneration(endpoint: URL, apiKey: string, signal: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  const timer = globalThis.setTimeout(
    () => controller.abort(new DOMException("OpenRouter usage recovery timed out.", "TimeoutError")),
    REQUEST_TIMEOUT_MS,
  );
  try {
    return await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });
  } finally {
    globalThis.clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

/**
 * OpenRouter normally includes usage in the final streamed SSE message. A
 * small number of routed model endpoints complete without that chunk. The
 * generation endpoint is OpenRouter's documented asynchronous source of the
 * same native token counts, keyed by the completion response id.
 */
export async function recoverOpenRouterUsage(
  providerId: string,
  baseUrl: string,
  apiKey: string,
  responseId: unknown,
  currentUsage: ModelUsage,
  signal: AbortSignal,
): Promise<PiUsage | undefined> {
  if (providerId !== "openrouter" || hasModelUsage(currentUsage)) return undefined;
  if (typeof responseId !== "string" || !responseId.trim() || !apiKey) return undefined;

  const endpoint = new URL(`${baseUrl.replace(/\/+$/, "")}/generation`);
  endpoint.searchParams.set("id", responseId.trim());

  for (const delayMs of RETRY_DELAYS_MS) {
    try {
      await wait(delayMs, signal);
      const response = await fetchGeneration(endpoint, apiKey, signal);
      if (response.ok) {
        const payload = await response.json() as { data?: OpenRouterGenerationData };
        const usage = payload.data ? generationUsage(payload.data) : undefined;
        if (usage) return usage;
      } else if (response.status !== 404 && response.status !== 409 && response.status !== 425) {
        return undefined;
      }
    } catch (error) {
      if (signal.aborted) throw error;
      return undefined;
    }
  }
  return undefined;
}
