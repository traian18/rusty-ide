import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "../components/ui";
import type { DocsClient, WorkspaceRepository } from "./client";
import styles from "./Docs.module.css";

export interface WorkspacePanelProps {
  client: DocsClient;
  /** The workspace folder. */
  root: string;
  /** The repository whose documentation is open. */
  activeRoot: string;
  /** Reload when this changes (an index was built). */
  revision: number;
  /** Opens a repository's documentation. */
  onOpen(repository: WorkspaceRepository): void;
  /** Called after a repository was indexed from here. */
  onIndexed(): void;
}

const absolute = (root: string, path: string) => (path === "." ? root : `${root.replace(/[\\/]+$/, "")}/${path}`);

/** The repositories of a workspace folder: which are indexed, with a way to open or index each. */
export function WorkspacePanel({ client, root, activeRoot, revision, onOpen, onIndexed }: WorkspacePanelProps) {
  const [repositories, setRepositories] = useState<WorkspaceRepository[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    client.workspaceRepositories(root).then(setRepositories, (failure) => setError(String((failure as { message?: unknown })?.message ?? failure)));
  }, [client, root]);
  useEffect(load, [load, revision]);

  const index = async (repository: WorkspaceRepository) => {
    setBusy(repository.id);
    try {
      await client.refresh(absolute(root, repository.path), false);
      onIndexed();
    } catch (failure) {
      setError(String((failure as { message?: unknown })?.message ?? failure));
    } finally {
      setBusy(null);
      load();
    }
  };

  if (repositories === null) return <div className={styles.page} role="status">{error ?? "Loading repositories…"}</div>;
  return (
    <section className={styles.page} aria-label="Workspace repositories">
      <h2 className={styles.title}>Repositories</h2>
      <p className={styles.summary}>
        Documentation is kept per repository. A repository is indexed when you open it here or when a request is about it; none is indexed just because it exists.
      </p>
      {error ? <p className={styles.gaps}>{error}</p> : null}
      <ul className={styles.facts}>
        {repositories.map((repository) => {
          const active = absolute(root, repository.path) === activeRoot || repository.id === activeRoot;
          return (
            <li key={repository.id} className={styles.fact}>
              <strong>{repository.name}</strong> <span className={styles.muted}>{repository.path}{repository.branch ? ` · ${repository.branch}` : ""}</span>{" "}
              <span className={styles.badge}>{repository.indexed ? `Indexed · ${repository.files} files` : "Not indexed"}</span>{" "}
              <Button variant="ghost" disabled={active} onClick={() => onOpen(repository)}>
                {active ? "Open" : "Open docs"}
              </Button>
              <Button variant="ghost" disabled={busy !== null} onClick={() => void index(repository)} icon={busy === repository.id ? <Loader2 size={12} className="animate-spin" /> : undefined}>
                {repository.indexed ? "Re-index" : "Index"}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
