import { useState } from "react";

import { toRepositoryError } from "../architecture/client";
import { Button, Callout } from "../components/ui";
import { useLoad } from "../dashboard/useLoad";
import { notify } from "../notificationStore";
import type { SpecsClient } from "./client";
import type { ChangeSummary, SwitchedPart } from "./model";
import { linkedParts, progressText, STATUS_TEXT, workspacePrefix } from "./pure";
import type { SpecsWorkspace } from "./SpecsPage";
import { useSpecsView } from "./specsState";
import styles from "./Specs.module.css";

export interface LinkedPartsProps {
  client: SpecsClient;
  root: string;
  workspace: SpecsWorkspace | null;
  change: ChangeSummary;
  revision: number;
}

const parentOf = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "").replace(/\/[^/]+$/, "");

/** `ide: already on it; core: switched (your work there was stashed)`. */
export function switchSummary(parts: readonly SwitchedPart[]): string {
  return parts
    .map(({ repository, outcome }) => {
      if (outcome.kind === "already") return `${repository}: already on it`;
      if (outcome.kind === "skipped") return `${repository}: skipped, ${outcome.reason}`;
      if (outcome.kind === "failed") return `${repository}: failed, ${outcome.message}`;
      const stash = outcome.stashed ? " (its uncommitted work was stashed for the branch it was on)" : "";
      return `${repository}: switched${outcome.restored ? ", earlier work restored" : ""}${stash}`;
    })
    .join("; ");
}

/** The other repositories' parts of a linked change: their state, a way to open each, and one
 * switch that puts every part on the change's branch. Nothing for a change that is not linked. */
export function LinkedParts({ client, root, workspace, change, revision }: LinkedPartsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Opened on its own, the repository's linked parts are looked for next to it.
  const base = workspace?.root ?? parentOf(root);
  const parts = linkedParts(change.links, base);
  const name = (workspacePrefix(root, workspace?.root) || `${root.split("/").pop()}/`).replace(/\/$/, "");
  const states = useLoad(
    () => Promise.all(parts.map((part) => client.overview(part.path).then((found) => found.changes.find((candidate) => candidate.dir === part.dir) ?? null, () => undefined))),
    [client, change.links.join(","), base, revision],
  );
  if (!parts.length) return null;

  const switchAll = async () => {
    setBusy(true);
    setError(null);
    try {
      notify(`Switched to ${change.branch ?? "the change's branch"}`, switchSummary(await client.switchLinked(workspace?.root ?? null, root, change.dir)), "info");
    } catch (failure) {
      setError(toRepositoryError(failure).message);
    } finally {
      setBusy(false);
    }
  };
  const open = (path: string, dir: string) => {
    useSpecsView.getState().openIn(path, { kind: "change", dir });
    workspace?.open(path);
  };
  const role = (repository: string) => (repository === (change.main ?? name) ? " · main spec" : "");

  return (
    <section className={styles.card} aria-label="Linked parts">
      <div className={styles.header}>
        <strong>This change spans {parts.length + 1} repositories</strong>
        <span style={{ flex: 1 }} />
        {change.branch ? (
          <Button variant="secondary" disabled={busy} title="Switch every repository of this change to its branch; uncommitted work is stashed for the branch it was on" onClick={() => void switchAll()}>
            Switch all to {change.branch}
          </Button>
        ) : null}
      </div>
      <ul className={styles.entries}>
        <li className={styles.entry}>
          <span className={styles.mono}>{name}</span>
          <span className={styles.muted}>
            {change.dir}, this part{role(name)}
          </span>
        </li>
        {parts.map((part, index) => {
          const state = states.value?.[index];
          const text = state ? `${STATUS_TEXT[state.status]}, tasks ${progressText(state)}` : state === null ? "not on this branch there; switch to see it" : state === undefined && states.value ? "repository not found" : "…";
          const openable = Boolean(workspace?.repositories.some((repository) => repository.path === part.path));
          return (
            <li key={part.path} className={styles.entry}>
              <span className={styles.mono}>{part.repository}</span>
              <span className={styles.muted} style={{ flex: 1 }}>
                {part.dir}
                {role(part.repository)}: {text}
              </span>
              {openable ? (
                <Button variant="ghost" onClick={() => open(part.path, part.dir)}>
                  Open
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {error ? <Callout variant="danger">{error}</Callout> : null}
    </section>
  );
}
