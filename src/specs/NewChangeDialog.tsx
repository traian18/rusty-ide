import { useState } from "react";

import { Button, Callout, Checkbox, Field, Input, Modal, Textarea } from "../components/ui";
import { toRepositoryError } from "../architecture/client";
import type { SpecsClient } from "./client";
import type { CreatedChange } from "./model";
import { localDate } from "./pure";
import styles from "./Specs.module.css";

export interface NewChangeDialogProps {
  client: SpecsClient;
  root: string;
  onClose(): void;
  onCreated(created: CreatedChange): void;
}

/** Asks for a title and a description, then creates the next numbered change. A branch is made by default. */
export function NewChangeDialog({ client, root, onClose, onCreated }: NewChangeDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [branch, setBranch] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      onCreated(await client.createChange(root, { title: title.trim(), description, date: localDate(), branch }));
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
        <Checkbox id="new-change-branch" checked={branch} onChange={(event) => setBranch(event.target.checked)} label="Create and switch to a Git branch for this change" />
        {error ? <Callout variant="danger">{error}</Callout> : null}
      </div>
    </Modal>
  );
}
