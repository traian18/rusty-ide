import { useState } from "react";

import { Button, Callout, Checkbox, Field, Input, Modal, Textarea } from "../components/ui";
import { toRepositoryError } from "../architecture/client";
import type { SpecsClient } from "./client";
import type { CreatedChange, CreatedPart } from "./model";
import { localDate } from "./pure";
import type { SpecsLevel, SpecsWorkspace } from "./SpecsPage";
import styles from "./Specs.module.css";

export interface NewChangeDialogProps {
  client: SpecsClient;
  root: string;
  /** With several repositories in the workspace, the change can span some of them. */
  workspace?: SpecsWorkspace | null;
  /** A workspace change keeps its specs in the workspace's `.rusty` folder; its branch is made in the repositories ticked. */
  level?: SpecsLevel;
  onClose(): void;
  /** `parts` lists every repository's part of a linked change, this one first. */
  onCreated(created: CreatedChange, parts?: CreatedPart[]): void;
}

/** Asks for a title and a description, then creates the next numbered change. A branch is made by default,
 * named `spec/<folder>` unless another name is typed.
 * In a workspace with several repositories it can also create a part in each repository ticked:
 * this repository holds the whole change's spec, and every part shares one branch name.
 * A workspace change has one spec in the workspace; the repositories ticked only get its branch. */
export function NewChangeDialog({ client, root, workspace = null, level = "repository", onClose, onCreated }: NewChangeDialogProps) {
  const inWorkspace = level === "workspace";
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [branch, setBranch] = useState(!inWorkspace);
  const [branchName, setBranchName] = useState("");
  const [linked, setLinked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const others = (workspace?.repositories ?? []).filter((repository) => repository.path !== root && repository.path !== workspace?.root);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const request = { title: title.trim(), description, date: localDate(), branch, branchName };
      if (inWorkspace) {
        onCreated(await client.createChange(root, { ...request, branch: branch && linked.length > 0, repositories: linked }));
      } else if (workspace && linked.length) {
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
        {others.length && !inWorkspace ? (
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
        <Checkbox id="new-change-branch" checked={branch} onChange={(event) => setBranch(event.target.checked)} label={inWorkspace ? "Create and switch to a Git branch for this change in the repositories ticked below" : linked.length ? "Create and switch to one Git branch for this change in every repository" : "Create and switch to a Git branch for this change"} />
        {branch ? (
          <Field id="new-change-branch-name" label="Branch name" hint="Leave empty for spec/<number>-<title>.">
            <Input id="new-change-branch-name" value={branchName} placeholder="spec/<number>-<title>" onChange={(event) => setBranchName(event.target.value)} />
          </Field>
        ) : null}
        {branch && inWorkspace && others.length ? (
          <fieldset className={styles.form} aria-label="Repositories">
            <legend className={styles.muted}>The repositories this change works in (the spec stays in the workspace):</legend>
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
        {error ? <Callout variant="danger">{error}</Callout> : null}
      </div>
    </Modal>
  );
}
