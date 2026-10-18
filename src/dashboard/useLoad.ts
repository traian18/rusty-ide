/** Loads one value for the current inputs, dropping answers that arrive after the inputs changed. */
import { useEffect, useState } from "react";

import { toRepositoryError } from "../architecture/client";

export interface Loaded<T> {
  value: T | null;
  error: string | null;
  loading: boolean;
}

export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[]): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ value: null, error: null, loading: true });
  useEffect(() => {
    let live = true;
    setState((current) => ({ ...current, loading: true, error: null }));
    load().then(
      (value) => live && setState({ value, error: null, loading: false }),
      (failure) => live && setState({ value: null, error: toRepositoryError(failure).message, loading: false }),
    );
    return () => {
      live = false;
    };
    // The caller lists what the load depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
