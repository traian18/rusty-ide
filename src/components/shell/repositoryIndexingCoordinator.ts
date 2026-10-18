/**
 * Hands the chosen repository to the host's background work. The host keeps the analysis on disk:
 * opening a repository loads what was saved (a repository never analysed gets one first analysis),
 * file changes are recorded and analysed after a quiet period, and work left unfinished by the last
 * run is resumed. All of it runs as jobs in the process bubble, never in the window. This module
 * only tells the host which repository is chosen and whether background work is switched on, and
 * resumes documentation updates the user had agreed to.
 */
import { listen } from "@tauri-apps/api/event";

import { tauriClient, type ArchitectureClient } from "../../architecture/client";
import { backgroundClient, type BackgroundClient, type Job } from "../../background/client";
import { useBackground } from "../../background/backgroundStore";
import { runDocumentationUpdate } from "../../background/documentationRunner";
import { repositoryIndexingEnabled } from "../../services/repositoryContextSettings";
import { useWorkspaceStore } from "../../store";

type Opener = Pick<ArchitectureClient, "open">;

export class RepositoryIndexer {
  private root: string | null = null;

  constructor(
    private readonly client: Opener,
    private readonly background: Pick<BackgroundClient, "setBackground">,
    private readonly resumeDocumentation: (root: string) => Promise<void> = runDocumentationUpdate,
    private readonly enabled: () => boolean = repositoryIndexingEnabled,
  ) {}

  /** The chosen repository changed: the host loads it (and resumes its work); documentation the
   * user agreed to update carries on. */
  workspaceChanged(root: string | null): void {
    this.root = root;
    void this.background.setBackground(this.enabled()).catch(() => undefined);
    if (!root) return;
    void this.client
      .open(root)
      .then(() => (this.root === root ? this.resumeDocumentation(root) : undefined))
      .catch(() => undefined);
  }

  stop(): void {
    this.root = null;
  }
}

/** The repository to keep indexed: the one chosen in the IDE, else the workspace folder. */
export function indexTarget(state: { rootPath: string | null; repositories: { id: string; worktreePath: string }[]; activeRepositoryId: string | null }): string | null {
  return state.repositories.find((repository) => repository.id === state.activeRepositoryId)?.worktreePath ?? state.rootPath;
}

let started = false;
let indexer: RepositoryIndexer | null = null;

/** Starts background work for the life of the app; idempotent. */
export function startRepositoryIndexing(): void {
  if (started) return;
  started = true;
  indexer = new RepositoryIndexer(tauriClient, backgroundClient);
  const current = indexer;
  listen<Job[]>("background-jobs", (event) => useBackground.getState().setJobs(event.payload)).catch(() => undefined);
  void backgroundClient.jobs().then((jobs) => useBackground.getState().setJobs(jobs)).catch(() => undefined);
  current.workspaceChanged(indexTarget(useWorkspaceStore.getState()));
  useWorkspaceStore.subscribe((state, previous) => {
    const target = indexTarget(state);
    if (target !== indexTarget(previous)) current.workspaceChanged(target);
  });
}
