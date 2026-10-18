import { useCallback, useEffect, useRef, useState } from "react";
import { toRepositoryError, type ArchitectureClient } from "./client";
import type { FindingBadges, Freshness, OpenResponse, RepositoryError, StageError } from "./model";

export type RepositoryStatus = "opening" | "no-snapshot" | "ready" | "error";

const FRESHNESS_DEBOUNCE_MS = 800;

export interface RepositorySession {
  status: RepositoryStatus;
  /** Why opening failed (status "error"). */
  error: RepositoryError | null;
  /** Why the last refresh failed; the previous snapshot stays usable. */
  refreshError: RepositoryError | null;
  stageErrors: StageError[];
  open: OpenResponse | null;
  badges: FindingBadges | null;
  freshness: Freshness | null;
  refreshing: boolean;
  /** Increments whenever a new snapshot arrives, so dependent queries reload. */
  revision: number;
  refresh(): Promise<void>;
  cancelRefresh(): Promise<void>;
  checkFreshness(): Promise<void>;
  /** Tries opening the workspace again after a failure. */
  retry(): void;
}

/** Opens the workspace, keeps its summaries, and tracks whether the snapshot is still current. */
export function useRepository(root: string, client: ArchitectureClient): RepositorySession {
  const [status, setStatus] = useState<RepositoryStatus>("opening");
  const [error, setError] = useState<RepositoryError | null>(null);
  const [refreshError, setRefreshError] = useState<RepositoryError | null>(null);
  const [stageErrors, setStageErrors] = useState<StageError[]>([]);
  const [open, setOpen] = useState<OpenResponse | null>(null);
  const [badges, setBadges] = useState<FindingBadges | null>(null);
  const [freshness, setFreshness] = useState<Freshness | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const live = useRef(true);

  const loadBadges = useCallback(async () => {
    try {
      const next = await client.findingBadges(root);
      if (live.current) setBadges(next);
    } catch {
      if (live.current) setBadges(null);
    }
  }, [client, root]);

  const checkFreshness = useCallback(async () => {
    try {
      const next = await client.freshness(root);
      if (live.current) setFreshness(next);
    } catch {
      // No snapshot yet, or the check failed: leave the previous report alone.
    }
  }, [client, root]);

  useEffect(() => {
    live.current = true;
    setStatus("opening");
    setError(null);
    client.open(root).then(
      async (response) => {
        if (!live.current) return;
        setOpen(response);
        setStatus(response.snapshot ? "ready" : "no-snapshot");
        if (response.snapshot) {
          setRevision((value) => value + 1);
          await Promise.all([loadBadges(), checkFreshness()]);
        }
      },
      (failure) => {
        if (!live.current) return;
        setError(toRepositoryError(failure));
        setStatus("error");
      },
    );
    return () => {
      live.current = false;
    };
  }, [client, root, attempt, loadBadges, checkFreshness]);

  // Workspace changes only trigger a cheap metadata check, never a scan.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    client.onWorkspaceChanged(() => {
      clearTimeout(timer);
      timer = setTimeout(() => void checkFreshness(), FRESHNESS_DEBOUNCE_MS);
    }).then((stop) => (disposed ? stop() : (unlisten = stop)));
    return () => {
      disposed = true;
      clearTimeout(timer);
      unlisten?.();
    };
  }, [client, checkFreshness]);

  // A background analysis finished: show what it built without asking the user to refresh.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    client
      .onAnalysisUpdated(() => {
        client.open(root).then(
          async (response) => {
            if (!live.current || !response.snapshot) return;
            setOpen(response);
            setStatus("ready");
            setRevision((value) => value + 1);
            await Promise.all([loadBadges(), checkFreshness()]);
          },
          () => undefined,
        );
      })
      .then((stop) => (disposed ? stop() : (unlisten = stop)))
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [client, root, loadBadges, checkFreshness]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const result = await client.refresh(root, true);
      if (!live.current) return;
      setStageErrors(result.stage_errors);
      setOpen((previous) => ({
        root: previous?.root ?? root,
        discovery: previous?.discovery ?? { cargo: true, package_json: true, symlink_safe: true },
        snapshot: result.snapshot,
        git: result.git,
        findings: result.findings,
        built_at_ms: result.built_at_ms,
      }));
      setStatus("ready");
      setRevision((value) => value + 1);
      await Promise.all([loadBadges(), checkFreshness()]);
    } catch (failure) {
      if (live.current) setRefreshError(toRepositoryError(failure));
    } finally {
      if (live.current) setRefreshing(false);
    }
  }, [client, root, loadBadges, checkFreshness]);

  const cancelRefresh = useCallback(() => client.cancel(root).catch(() => undefined), [client, root]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { status, error, refreshError, stageErrors, open, badges, freshness, refreshing, revision, refresh, cancelRefresh, checkFreshness, retry };
}
