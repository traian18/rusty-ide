/**
 * Loads ELK lazily, running its layout in a web worker so large levels never block the UI. Kept
 * apart from `layoutElk.ts` so tests use the real engine directly and never touch the worker.
 */
import type { ElkLike } from "./layoutElk";

let loaded: Promise<ElkLike | null> | null = null;

export function loadElk(): Promise<ElkLike | null> {
  loaded ??= (async () => {
    try {
      const [{ default: ELK }, { default: ElkWorker }] = await Promise.all([
        import("elkjs/lib/elk-api.js"),
        import("elkjs/lib/elk-worker.min.js?worker"),
      ]);
      return new ELK({ workerFactory: () => new ElkWorker() }) as unknown as ElkLike;
    } catch {
      // The in-house layout takes over; the canvas says so.
      return null;
    }
  })();
  return loaded;
}
