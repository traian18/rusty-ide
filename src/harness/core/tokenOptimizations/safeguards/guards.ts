// ============================================================
// safeguards/guards.ts -- the two rules every optimisation runs under:
//   never worse  an optimisation may not hand the model more than the
//                original; if it would, the original goes instead
//   fail open    an optimisation that throws is skipped, and the
//                original goes on unchanged; saving tokens never stops
//                a command's result, a prompt or a model turn
// ============================================================

/** `optimized` when it is no larger than `original`, else `original`. */
export function neverWorse(original: string, optimized: string): { text: string; used: boolean } {
  return optimized.length > original.length ? { text: original, used: false } : { text: optimized, used: true };
}

/** `attempt()`, or `fallback` when it throws. */
export function failOpen<T>(attempt: () => T, fallback: T): T {
  try {
    return attempt();
  } catch (error: unknown) {
    console.warn("A token optimisation failed and was skipped:", error);
    return fallback;
  }
}
