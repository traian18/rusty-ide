// Mistral's client is created without retries, and Mistral sometimes ends a
// stream with `finish_reason: "error"` (a failure on its side, which pi-ai
// reports as "An unknown error occurred"). Those, rate limits, 5xx responses
// and dropped connections are retried a few times while nothing has been
// streamed yet.

let MISTRAL_RETRY_DELAYS_MS = [1_000, 3_000, 8_000];

/** Tests only: shorten the waits between Mistral retries. */
export function setMistralRetryDelaysForTests(delays: number[]): void {
  MISTRAL_RETRY_DELAYS_MS = delays;
}

function isTransientMistralError(message: string): boolean {
  return message === "An unknown error occurred"
    || /Mistral API error \((429|5\d\d)\)/.test(message)
    // Network failures, as each engine words them: WebKit (the macOS app)
    // says "Load failed", Chromium "Failed to fetch", Firefox "NetworkError";
    // Mistral's SDK wraps them as "Unexpected HTTP client error".
    || /Load failed|Failed to fetch|NetworkError|Unexpected HTTP client error|fetch failed|network|connection|ECONNRESET|socket hang up|timed? ?out/i.test(message);
}

function describeMistralError(message: string, retries: number): string {
  const tried = retries > 0 ? ` (after ${retries} ${retries === 1 ? "retry" : "retries"})` : "";
  if (message === "An unknown error occurred") {
    return `Mistral ended the response with an error on its side${tried}; it gave no details. Trying again usually works.`;
  }
  return `${message}${tried}`;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(signal.reason ?? new Error("aborted")); };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Whether anything reached the agent yet: a retry after that would repeat it. */
export interface StreamProgress {
  emitted: boolean;
}

/** Runs one Mistral request, again after a transient failure while nothing
 * has been streamed, and explains the failure it finally gives up on. */
export async function withMistralRetries<T>(request: (progress: StreamProgress) => Promise<T>, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const progress: StreamProgress = { emitted: false };
    try {
      return await request(progress);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (signal.aborted) throw error;
      const retryable = !progress.emitted && attempt < MISTRAL_RETRY_DELAYS_MS.length;
      if (!retryable || !isTransientMistralError(message)) throw new Error(describeMistralError(message, attempt));
      console.warn(`Mistral request failed (${message}); retrying in ${MISTRAL_RETRY_DELAYS_MS[attempt]} ms (retry ${attempt + 1} of ${MISTRAL_RETRY_DELAYS_MS.length}).`);
      await delay(MISTRAL_RETRY_DELAYS_MS[attempt], signal);
    }
  }
}
