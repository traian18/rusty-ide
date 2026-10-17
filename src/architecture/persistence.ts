/**
 * The saved user layer: node positions per view, collapsed groups, view preferences, and notes.
 * It lives apart from source-derived snapshots and is keyed by stable node keys, so a refresh
 * never edits it. A note whose node has disappeared is reported as orphaned and kept until the
 * user deletes it. Pure: no React, store, or Tauri imports.
 */
import { isNodeKey, type NodeKey } from "./identity";

export const DOCUMENT_VERSION = 1;
/** Positions remembered per view; beyond this the lexically last keys are dropped. */
export const MAX_POSITIONS_PER_VIEW = 5000;
export const MAX_NOTE_LENGTH = 4000;

export interface SavedPoint {
  x: number;
  y: number;
}

export interface Note {
  id: string;
  node: NodeKey;
  text: string;
  created: number;
  updated: number;
}

export interface SavedView {
  importKind: "all" | "runtime" | "type_only";
  /** Saved as `colorMode`, so a colouring chosen before per-package colours existed is not kept. */
  colorMode: "node" | "language" | "kind" | "severity";
  /** Share of the edge weight drawn in the levelled view, in percent; saved as `edgeShare`, so the earlier 80% default is not kept. */
  edgeShare: number;
  /** Distance between nodes in the levelled view, in percent of the base distance. */
  spacing: number;
  /** Whether framework relations are drawn. */
  frameworks: boolean;
}

export interface ArchitectureDocument {
  version: typeof DOCUMENT_VERSION;
  /** viewKey -> node key -> position. */
  layouts: Record<string, Record<string, SavedPoint>>;
  view: SavedView;
  notes: Note[];
}

export const emptyDocument = (): ArchitectureDocument => ({
  version: DOCUMENT_VERSION,
  layouts: {},
  view: { importKind: "all", colorMode: "node", edgeShare: 100, spacing: 160, frameworks: false },
  notes: [],
});

export interface ParsedDocument {
  document: ArchitectureDocument;
  /** Why saved data was ignored, for a one-line notice; null when everything was read. */
  warning: string | null;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Reads whatever was saved. Anything unreadable is dropped, never thrown on. */
export function parseDocument(raw: unknown): ParsedDocument {
  if (raw === null || raw === undefined) return { document: emptyDocument(), warning: null };
  if (typeof raw !== "object" || (raw as { version?: unknown }).version !== DOCUMENT_VERSION) {
    return { document: emptyDocument(), warning: "Saved layout was written by a different version and was ignored." };
  }
  const source = raw as Record<string, unknown>;
  const document = emptyDocument();
  let dropped = 0;

  if (source.layouts && typeof source.layouts === "object") {
    for (const [viewKey, positions] of Object.entries(source.layouts as Record<string, unknown>)) {
      if (!positions || typeof positions !== "object") {
        dropped++;
        continue;
      }
      const clean: Record<string, SavedPoint> = {};
      for (const [key, point] of Object.entries(positions as Record<string, unknown>)) {
        const p = point as { x?: unknown; y?: unknown };
        if (isNodeKey(key) && finite(p?.x) && finite(p?.y)) clean[key] = { x: p.x, y: p.y };
        else dropped++;
      }
      document.layouts[viewKey] = clean;
    }
  }
  const view = source.view as Partial<SavedView> | undefined;
  if (view && ["all", "runtime", "type_only"].includes(view.importKind as string)) {
    document.view.importKind = view.importKind as SavedView["importKind"];
  }
  if (view && ["node", "language", "kind", "severity"].includes(view.colorMode as string)) document.view.colorMode = view.colorMode as SavedView["colorMode"];
  if (view && finite(view.edgeShare) && view.edgeShare >= 10 && view.edgeShare <= 100) document.view.edgeShare = Math.round(view.edgeShare);
  if (view && typeof view.frameworks === "boolean") document.view.frameworks = view.frameworks;
  if (view && finite(view.spacing) && view.spacing >= 50 && view.spacing <= 400) document.view.spacing = Math.round(view.spacing);
  if (Array.isArray(source.notes)) {
    for (const entry of source.notes) {
      const note = entry as Partial<Note>;
      if (
        typeof note?.id === "string" && isNodeKey(note.node) && typeof note.text === "string" &&
        finite(note.created) && finite(note.updated)
      ) {
        document.notes.push({ id: note.id, node: note.node, text: note.text.slice(0, MAX_NOTE_LENGTH), created: note.created, updated: note.updated });
      } else dropped++;
    }
  }
  return { document, warning: dropped ? `${dropped} saved item${dropped === 1 ? "" : "s"} could not be read and were skipped.` : null };
}

/** Notes split into those whose node still exists and those that lost it. Nothing is dropped. */
export function reconcileNotes(
  notes: readonly Note[],
  existing: ReadonlySet<NodeKey>,
): { attached: Note[]; orphaned: Note[] } {
  const attached: Note[] = [];
  const orphaned: Note[] = [];
  for (const note of notes) (existing.has(note.node) ? attached : orphaned).push(note);
  return { attached, orphaned };
}

/** Records positions for one view, keeping remembered positions of nodes not currently shown. */
export function withLayout(
  document: ArchitectureDocument,
  viewKey: string,
  positions: Readonly<Record<string, SavedPoint>>,
): ArchitectureDocument {
  const merged: Record<string, SavedPoint> = { ...(document.layouts[viewKey] ?? {}), ...positions };
  const keys = Object.keys(merged).sort();
  const kept = keys.slice(0, MAX_POSITIONS_PER_VIEW);
  return { ...document, layouts: { ...document.layouts, [viewKey]: Object.fromEntries(kept.map((key) => [key, merged[key]])) } };
}

export function withoutPosition(document: ArchitectureDocument, viewKey: string, key: string): ArchitectureDocument {
  const view = { ...(document.layouts[viewKey] ?? {}) };
  delete view[key];
  return { ...document, layouts: { ...document.layouts, [viewKey]: view } };
}

export function addNote(document: ArchitectureDocument, node: NodeKey, text: string, now: number, id: string): ArchitectureDocument {
  const trimmed = text.trim().slice(0, MAX_NOTE_LENGTH);
  if (!trimmed) return document;
  return { ...document, notes: [...document.notes, { id, node, text: trimmed, created: now, updated: now }] };
}

export function editNote(document: ArchitectureDocument, id: string, text: string, now: number): ArchitectureDocument {
  const trimmed = text.trim().slice(0, MAX_NOTE_LENGTH);
  if (!trimmed) return document;
  return { ...document, notes: document.notes.map((note) => (note.id === id ? { ...note, text: trimmed, updated: now } : note)) };
}

export function deleteNote(document: ArchitectureDocument, id: string): ArchitectureDocument {
  return { ...document, notes: document.notes.filter((note) => note.id !== id) };
}
