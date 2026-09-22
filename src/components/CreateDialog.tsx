import React, { useState, useRef } from "react";
import { FilePlus, FolderPlus } from "lucide-react";
import { Modal } from "./ui/Modal/Modal";
import { Button } from "./ui/Button/Button";
import { Field } from "./ui/FormControls/Field";
import { Input } from "./ui/FormControls/Input";
import styles from "./CreateDialog.module.css";

interface CreateDialogProps {
  type: "file" | "folder";
  parentDir: string;
  onCreate: (name: string) => void;
  onCancel: () => void;
}

const truncatePathStart = (path: string, maxLen = 50) => {
  if (path.length <= maxLen) return path;
  return "…" + path.substring(path.length - maxLen + 1);
};

export const CreateDialog: React.FC<CreateDialogProps> = ({ type, parentDir, onCreate, onCancel }) => {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const Icon = type === "file" ? FilePlus : FolderPlus;

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed);
  };

  return (
    <Modal
      id="create-dialog"
      title={`New ${type === "file" ? "File" : "Folder"}`}
      icon={Icon}
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <Button id="create-dialog-cancel" type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            id="create-dialog-confirm"
            type="button"
            variant="primary"
            onClick={handleCreate}
            disabled={!name.trim()}
          >
            Create
          </Button>
        </>
      }
    >
      <p className={styles.pathHint}>
        Inside: <span title={parentDir} className={styles.pathValue}>{truncatePathStart(parentDir)}</span>
      </p>
      <Field id="create-dialog-name" label={type === "file" ? "File name" : "Folder name"}>
        <Input
          ref={inputRef}
          id="create-dialog-name"
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreate();
          }}
          placeholder={type === "file" ? "e.g. component.tsx" : "e.g. components"}
        />
      </Field>
    </Modal>
  );
};
