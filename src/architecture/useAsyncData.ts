import { useEffect, useState } from "react";
import { toRepositoryError } from "./client";
import type { RepositoryError } from "./model";

export type AsyncData<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; error: RepositoryError };

/** Runs `load` whenever `key` changes; stale results from an earlier key are discarded. */
export function useAsyncData<T>(key: string | null, load: () => Promise<T>): AsyncData<T> {
  const [state, setState] = useState<{ key: string | null; value: AsyncData<T> }>({ key: null, value: { status: "loading" } });
  useEffect(() => {
    if (key === null) return;
    let current = true;
    setState({ key, value: { status: "loading" } });
    load().then(
      (data) => current && setState({ key, value: { status: "ready", data } }),
      (error) => current && setState({ key, value: { status: "error", error: toRepositoryError(error) } }),
    );
    return () => {
      current = false;
    };
    // `load` is intentionally keyed by `key`: callers fold everything it reads into the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state.value : { status: "loading" };
}
