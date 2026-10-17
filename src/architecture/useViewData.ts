import { useEffect, useState } from "react";
import { toRepositoryError, type ArchitectureClient } from "./client";
import type { GroupGraph, LevelView, RepositoryError } from "./model";

export interface ViewData {
  /** The folders of the focus, unless it has none. */
  levelView: LevelView | null;
  drill: GroupGraph | null;
  loading: boolean;
  error: RepositoryError | null;
}

/**
 * Loads what to show for a focus (the top when null) in the current snapshot: its folders and
 * loose files, or, when it has no folders, its files.
 */
export function useViewData(
  root: string,
  client: ArchitectureClient,
  options: { enabled: boolean; revision: number; focus: string | null },
): ViewData {
  const { enabled, revision, focus } = options;
  const [state, setState] = useState<ViewData>({ levelView: null, drill: null, loading: false, error: null });

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    setState((previous) => ({ ...previous, loading: true, error: null }));
    const request: Promise<Pick<ViewData, "levelView" | "drill">> = client
      .architecture(root, focus === null ? { level: "packages", focus: null } : { level: "components", focus })
      .then((levelView) =>
        levelView.leaf && focus !== null ? client.groupGraph(root, { group: focus }).then((drill) => ({ levelView: null, drill })) : { levelView, drill: null },
      );
    request.then(
      (result) => current && setState({ ...result, loading: false, error: null }),
      (failure) => current && setState({ levelView: null, drill: null, loading: false, error: toRepositoryError(failure) }),
    );
    return () => {
      current = false;
    };
  }, [client, root, enabled, revision, focus]);

  return state;
}
