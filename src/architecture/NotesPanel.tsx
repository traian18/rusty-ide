import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "../components/ui";
import { parseNodeKey, type NodeKey } from "./identity";
import type { Note } from "./persistence";
import styles from "./Architecture.module.css";

export interface NotesPanelProps {
  selection: NodeKey | null;
  notes: Note[];
  /** Notes whose node no longer exists in the repository. */
  orphaned: Note[];
  onAdd(node: NodeKey, text: string): void;
  onEdit(id: string, text: string): void;
  onDelete(id: string): void;
}

function NoteItem({ note, onEdit, onDelete }: { note: Note; onEdit(id: string, text: string): void; onDelete(id: string): void }) {
  const [draft, setDraft] = useState(note.text);
  return (
    <li className={styles.row}>
      <textarea className={styles.textarea} aria-label="Note text" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => draft !== note.text && onEdit(note.id, draft)} />
      <span className={styles.rowHeader}>
        <span className={styles.muted}>Your note · {new Date(note.updated).toLocaleDateString()}</span>
        <button className={styles.linkButton} onClick={() => onDelete(note.id)} aria-label="Delete note">
          <Trash2 size={12} />
        </button>
      </span>
    </li>
  );
}

const describeNode = (key: NodeKey) => {
  const parsed = parseNodeKey(key);
  return parsed ? `${parsed.type === "group" ? "Group" : "File"} ${parsed.id}` : key;
};

/** Notes belong to the person, not to the analysis; a refresh never edits or removes them. */
export function NotesPanel({ selection, notes, orphaned, onAdd, onEdit, onDelete }: NotesPanelProps) {
  const [draft, setDraft] = useState("");
  const selected = selection ? notes.filter((note) => note.node === selection) : [];
  return (
    <div>
      <div className={styles.section}>
        <h4 className={styles.sectionTitle}>{selection ? describeNode(selection) : "Select a node to add a note"}</h4>
        <ul className={styles.list}>
          {selected.map((note) => (
            <NoteItem key={`${note.id}:${note.updated}`} note={note} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </ul>
        {selection ? (
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              onAdd(selection, draft);
              setDraft("");
            }}
          >
            <textarea className={styles.textarea} aria-label="New note" placeholder="Add a note (kept on this computer, never in the repository)" value={draft} onChange={(event) => setDraft(event.target.value)} />
            <Button type="submit" disabled={!draft.trim()}>
              Add note
            </Button>
          </form>
        ) : null}
      </div>
      {orphaned.length ? (
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>Orphaned notes ({orphaned.length})</h4>
          <p className={styles.muted}>These notes belong to files or groups that no longer exist. They are kept until you delete them.</p>
          <ul className={styles.list}>
            {orphaned.map((note) => (
              <li key={note.id} className={styles.row}>
                <span className={styles.muted}>{describeNode(note.node)}</span>
                <span>{note.text}</span>
                <button className={styles.linkButton} onClick={() => onDelete(note.id)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
