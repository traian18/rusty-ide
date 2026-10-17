import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ArchitectureClient } from "./client";
import { parseDocument, reconcileNotes, type ArchitectureDocument, type Note, emptyDocument } from "./persistence";
import { parseNodeKey, type NodeKey } from "./identity";

const SAVE_DELAY_MS = 500;

export interface UserLayer {
  loaded: boolean;
  document: ArchitectureDocument;
  /** Why saved data was partly ignored, if it was. */
  warning: string | null;
  /** Notes whose node no longer exists; kept until the user deletes them. */
  orphaned: Note[];
  update(change: (document: ArchitectureDocument) => ArchitectureDocument): void;
}

/**
 * The saved layout and notes for a workspace. Changes save after a short delay and again on
 * unmount; reading or writing failures never block the canvas.
 */
export function useUserLayer(root: string, client: ArchitectureClient, options: { hasSnapshot: boolean; revision: number }): UserLayer {
  const [document, setDocument] = useState<ArchitectureDocument>(emptyDocument);
  const [loaded, setLoaded] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [existing, setExisting] = useState<ReadonlySet<NodeKey> | null>(null);
  const pending = useRef<ArchitectureDocument | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const next = pending.current;
    pending.current = null;
    if (next) client.saveState(root, next).catch(() => setWarning("Your layout and notes could not be saved."));
  }, [client, root]);

  useEffect(() => {
    let current = true;
    setLoaded(false);
    client.loadState(root).then(
      (raw) => {
        if (!current) return;
        const parsed = parseDocument(raw);
        setDocument(parsed.document);
        setWarning(parsed.warning);
        setLoaded(true);
      },
      () => {
        if (!current) return;
        setDocument(emptyDocument());
        setWarning("Saved layout and notes could not be read.");
        setLoaded(true);
      },
    );
    return () => {
      current = false;
      flush();
    };
  }, [client, root, flush]);

  const update = useCallback(
    (change: (document: ArchitectureDocument) => ArchitectureDocument) => {
      setDocument((previous) => {
        const next = change(previous);
        if (next !== previous) {
          pending.current = next;
          clearTimeout(timer.current);
          timer.current = setTimeout(flush, SAVE_DELAY_MS);
        }
        return next;
      });
    },
    [flush],
  );

  // Which noted nodes still exist in the current snapshot (a note's node may simply be off screen).
  const noteNodes = useMemo(() => document.notes.map((note) => note.node).sort().join("\n"), [document.notes]);
  const { hasSnapshot, revision } = options;
  useEffect(() => {
    if (!hasSnapshot || !noteNodes) {
      setExisting(null);
      return;
    }
    let current = true;
    const keys = noteNodes.split("\n").map(parseNodeKey).filter((key): key is NonNullable<typeof key> => key !== null);
    client
      .nodesExist(root, {
        groups: keys.filter((key) => key.type === "group").map((key) => key.id),
        files: keys.filter((key) => key.type === "file").map((key) => key.id),
      })
      .then(
        (found) => current && setExisting(new Set<NodeKey>([...found.groups.map((id) => `group:${id}` as NodeKey), ...found.files.map((id) => `file:${id}` as NodeKey)])),
        () => current && setExisting(null),
      );
    return () => {
      current = false;
    };
  }, [client, root, hasSnapshot, revision, noteNodes]);

  const orphaned = useMemo(
    () => (existing ? reconcileNotes(document.notes, existing).orphaned : []),
    [existing, document.notes],
  );
  return { loaded, document, warning, orphaned, update };
}
