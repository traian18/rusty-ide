import { useState } from "react";
import { toRepositoryError } from "../../architecture";
import { Button, Callout } from "../../../lib/ui";
import { useLoad } from "../../dashboard/ui";
import { notify } from "../../notifications";
import type { SpecsClient } from "../client";
import styles from "./Specs.module.css";

export const DECLINED_KEY = "rusty.specs.workspaceRepositoryDeclined";

export function declined(workspace: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem(DECLINED_KEY) ?? "[]") as string[]).includes(workspace);
  } catch {
    return false;
  }
}

export function decline(workspace: string) {
  try {
    const list = JSON.parse(localStorage.getItem(DECLINED_KEY) ?? "[]") as string[];
    localStorage.setItem(DECLINED_KEY, JSON.stringify([...list, workspace]));
  } catch {
    // Without storage the offer simply shows again next time.
  }
}

/** Offers to keep the workspace's specs, skills and workflows in a Git repository of the workspace folder, once. */
export function WorkspaceRepositoryOffer({ client, workspace }: { client: SpecsClient; workspace: string }) {
  const [hidden, setHidden] = useState(() => declined(workspace));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = useLoad(() => client.workspaceRepository(workspace).catch(() => null), [client, workspace, hidden]);
  if (hidden || !status.value || status.value.exists) return null;
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await client.createWorkspaceRepository(workspace);
      notify("Workspace repository created", created.committed ? "The specs, skills and workflows are committed. The repositories in the workspace, chats and runs are ignored." : `The repository exists, but nothing was committed: ${created.reason ?? "unknown reason"}.`, "info");
      setHidden(true);
    } catch (failure) {
      setError(toRepositoryError(failure).message);
      setBusy(false);
    }
  };
  return (
    <Callout variant="info">
      <p>
        Keep the workspace's specs, skills and workflows in Git? This makes the workspace folder a repository that tracks only <code>.rusty/specs</code>, <code>.rusty/skills</code>, <code>.rusty/workflows</code>, <code>.rusty/profiles</code> and <code>.rusty/canvas</code>. The repositories inside the workspace, chats, runs, metrics and traces are ignored.
      </p>
      {error ? <p>{error}</p> : null}
      <div className={styles.actions}>
        <Button variant="primary" disabled={busy} onClick={() => void create()}>
          Create workspace repository
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            decline(workspace);
            setHidden(true);
          }}
        >
          Not now
        </Button>
      </div>
    </Callout>
  );
}
