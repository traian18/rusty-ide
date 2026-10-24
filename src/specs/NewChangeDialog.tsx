import { useState } from "react";

import { Button, Callout, Checkbox, Field, Input, Modal, Textarea } from "../components/ui";
import { toRepositoryError } from "../architecture/client";
import type { SpecsClient } from "./client";
import type { CreatedChange, CreatedPart } from "./model";
import { localDate } from "./pure";
import type { SpecsWorkspace } from "./SpecsPage";
import styles from "./Specs.module.css";

export interface NewChangeDialogProps {
  client: SpecsClient;
  root: string;
  /** With several repositories in the workspace, the change can span some of them. */
  workspace?: SpecsWorkspace | null;
  onClose(): void;
  /** `parts` lists every repository's part of a linked change, this one first. */
  onCreated(created: CreatedChange, parts?: CreatedPart[]): void;
}

/** Asks for a title and a description, then creates the next numbered change. A branch is made by default.
 * In a workspace with several repositories it can also create a part in each repository ticked:
 * this repository holds the whole change's spec, and every part shares one branch name. */
export function NewChangeDialog({ client, root, workspace = null, onClose, onCreated }: NewChangeDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [branch, setBranch] = useState(true);
  const [linked, setLinked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const others = (workspace?.repositories ?? []).filter((repository) => repository.path !== root);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const request = { title: title.trim(), description, date: localDate(), branch };
      if (workspace && linked.length) {
        const parts = await client.createLinkedChange(workspace.root, [root, ...linked], root, request);
        const own = parts.find((part) => part.main) ?? parts[0];
        onCreated({ dir: own.dir, files: own.files, branch: own.branch }, parts);
      } else {
        onCreated(await client.createChange(root, request));
      }
    } catch (failure) {
      setError(toRepositoryError(failure).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      id="new-change"
      title="New change"
      description="A change gets its own numbered folder with a spec to fill in."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || !title.trim()} onClick={() => void create()}>
            Create
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <Field id="new-change-name" label="Title">
          <Input id="new-change-name" value={title} placeholder="Photo albums" autoFocus onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field id="new-change-description" label="Why" hint="A sentence or two; it becomes the Why section of the spec.">
          <Textarea id="new-change-description" value={description} rows={4} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        {others.length ? (
          <fieldset className={styles.form} aria-label="Repositories">
            <legend className={styles.muted}>Also changes, each with its own part linked to this one (this repository holds the main spec):</legend>
            {others.map((repository) => (
              <Checkbox
                key={repository.path}
                id={`new-change-repository-${repository.name}`}
                checked={linked.includes(repository.path)}
                onChange={(event) => setLinked((paths) => (event.target.checked ? [...paths, repository.path] : paths.filter((path) => path !== repository.path)))}
                label={repository.name}
              />
            ))}
          </fieldset>
        ) : null}
        <Checkbox id="new-change-branch" checked={branch} onChange={(event) => setBranch(event.target.checked)} label={linked.length ? "Create and switch to one Git branch for this change in every repository" : "Create and switch to a Git branch for this change"} />
        {error ? <Callout variant="danger">{error}</Callout> : null}
      </div>
    </Modal>
  );
}
