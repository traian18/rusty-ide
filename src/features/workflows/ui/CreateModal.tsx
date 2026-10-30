import React, { useState } from "react";
import { ID_PATTERN, type Mode } from "./documents";
import { Button, Field, Input, Modal } from "../../../lib/ui";

export const CreateModal: React.FC<{
  kind: Mode;
  taken: string[];
  onCancel: () => void;
  onCreate: (id: string) => void;
}> = ({ kind, taken, onCancel, onCreate }) => {
  const [id, setId] = useState("");
  const error = !id
    ? undefined
    : !ID_PATTERN.test(id)
      ? "Use lowercase letters, digits, dots, dashes or underscores."
      : id.startsWith("rusty.")
        ? "Ids starting with rusty. are reserved for built-ins."
        : taken.includes(id)
          ? "That id is already used."
          : undefined;
  const submit = () => {
    if (id && !error) onCreate(id);
  };
  return (
    <Modal
      id="behaviors-create"
      title={kind === "profiles" ? "New behavior profile" : "New workflow"}
      description={
        kind === "profiles"
          ? "Saved as .rusty/profiles/<id>.json. Starts as a draft with no rules."
          : "Your editable workflow will be saved as .rusty/workflows/<id>.json."
      }
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="primary" disabled={!id || Boolean(error)} onClick={submit}>
            Create
          </Button>
        </>
      }
    >
      <Field id="behaviors-create-id" label="Id" error={error}>
        <Input
          id="behaviors-create-id"
          autoFocus
          value={id}
          placeholder={kind === "profiles" ? "careful-editor" : "plan-build-verify"}
          onChange={(event) => setId(event.target.value.trim())}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
      </Field>
    </Modal>
  );
};
