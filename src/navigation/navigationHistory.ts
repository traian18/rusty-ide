// ============================================================
// navigation/navigationHistory.ts -- Back and Forward through the places the
// cursor has been, across files (IntelliJ's Navigate Back/Forward,
// Cmd+Option+Left/Right).
//
// Layers:
// - the history itself (`recordLocation`, `stepHistory`): pure, so the rules
//   are easy to test;
// - the app's one history (`noteCursor`, `navigate`), fed by every file
//   editor's cursor and tab activation, and the editors it can move.
//
// A cursor move near the current place updates that place; a jump (another
// file, or more than NEARBY_LINES away) adds a new one and drops what was
// ahead of it, as in a browser.
// ============================================================

import { useWorkspaceStore } from "../store";

/** A place in a file. */
export interface EditorLocation {
  path: string;
  /** The canvas whose virtual file system holds the file, if any. */
  vfsTabId?: string;
  line: number;
  column: number;
}

export interface NavigationHistory {
  entries: EditorLocation[];
  /** The place the cursor is at now; -1 when the history is empty. */
  index: number;
}

/** Cursor moves within this many lines stay the same place. */
export const NEARBY_LINES = 10;
/** The oldest places are forgotten past this many. */
export const MAX_LOCATIONS = 100;

export const EMPTY_HISTORY: NavigationHistory = { entries: [], index: -1 };

function sameFile(a: EditorLocation, b: EditorLocation): boolean {
  return a.path === b.path && a.vfsTabId === b.vfsTabId;
}

/** The history after the cursor reached `location`. */
export function recordLocation(history: NavigationHistory, location: EditorLocation): NavigationHistory {
  const current = history.entries[history.index];
  if (current && sameFile(current, location) && Math.abs(current.line - location.line) <= NEARBY_LINES) {
    const entries = [...history.entries];
    entries[history.index] = location;
    return { entries, index: history.index };
  }
  const entries = [...history.entries.slice(0, history.index + 1), location].slice(-MAX_LOCATIONS);
  return { entries, index: entries.length - 1 };
}

/** One step back (-1) or forward (1), with the place to go to; no target at either end. */
export function stepHistory(history: NavigationHistory, direction: -1 | 1): { history: NavigationHistory; target?: EditorLocation } {
  const index = history.index + direction;
  const target = history.entries[index];
  if (!target) return { history };
  return { history: { entries: history.entries, index }, target };
}

// ---- The app's history -------------------------------------------------

/** How long after a Back/Forward the cursor events it causes are ignored. */
const ARRIVAL_MS = 400;

let history: NavigationHistory = EMPTY_HISTORY;
let ignoreUntil = 0;
const editors = new Map<string, any>();

/** A file tab's Monaco editor, so Back/Forward can place the cursor in it. */
export function registerEditor(tabId: string, editor: unknown): void {
  editors.set(tabId, editor);
}

export function unregisterEditor(tabId: string, editor?: unknown): void {
  if (editor === undefined || editors.get(tabId) === editor) editors.delete(tabId);
}

/** Called when a file editor's cursor moves or its tab becomes active. */
export function noteCursor(location: EditorLocation): void {
  if (Date.now() < ignoreUntil) return;
  history = recordLocation(history, location);
}

/** Called when a file tab's editor mounts. A newly opened file is shown before its editor exists,
 * so its activation recorded nothing: its first position is a place when the tab is the active one. */
export function noteMountedEditor(tabId: string, location: EditorLocation): void {
  if (useWorkspaceStore.getState().activeTabId === tabId) noteCursor(location);
}

/** Goes back (-1) or forward (1). Whether there was somewhere to go. */
export function navigate(direction: -1 | 1): boolean {
  const step = stepHistory(history, direction);
  const target = step.target;
  if (!target) return false;
  history = step.history;
  ignoreUntil = Date.now() + ARRIVAL_MS;
  const tabId = useWorkspaceStore.getState().openTab({ type: "file", path: target.path, line: target.line, vfsTabId: target.vfsTabId });
  // An open editor gets the exact position now and once more after the tab
  // is shown; a tab that is still mounting scrolls to `line` by itself.
  const place = () => {
    const editor = editors.get(tabId);
    if (!editor) return;
    editor.setPosition({ lineNumber: target.line, column: target.column });
    editor.revealLineInCenterIfOutsideViewport?.(target.line);
    editor.focus?.();
  };
  place();
  setTimeout(place, 60);
  return true;
}

/** For tests: start again with an empty history. */
export function resetNavigationHistory(): void {
  history = EMPTY_HISTORY;
  ignoreUntil = 0;
  editors.clear();
}

/** For tests and diagnostics. */
export function currentNavigationHistory(): NavigationHistory {
  return history;
}
