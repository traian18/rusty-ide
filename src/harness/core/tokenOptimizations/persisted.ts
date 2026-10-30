// ============================================================
// persisted.ts -- a small JSON value kept in localStorage with change
// listeners, shared by the switches and the statistics. Storage can be
// missing (tests, private windows) or full; then the value lives in
// memory for the session and nothing fails.
// ============================================================

export interface Persisted<T> {
  get(): T;
  set(value: T): void;
  subscribe(listener: () => void): () => void;
}

export function persisted<T>(key: string, initial: () => T, revive: (stored: unknown) => T): Persisted<T> {
  let value: T | undefined;
  const listeners = new Set<() => void>();
  const load = (): T => {
    try {
      const raw = globalThis.localStorage?.getItem(key);
      return raw ? revive(JSON.parse(raw)) : initial();
    } catch {
      return initial();
    }
  };
  return {
    get: () => (value ??= load()),
    set: (next) => {
      value = next;
      try {
        globalThis.localStorage?.setItem(key, JSON.stringify(next));
      } catch {
        // Kept in memory only.
      }
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
