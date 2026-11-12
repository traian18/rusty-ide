// Where the reader left each chat's scroller, by scroll key (an agent chat's id, an explorer
// node's id): the offset, and whether it was pinned to the bottom. A pinned chat comes back at its
// bottom however much it grew while hidden; another comes back at its offset. Kept in memory for
// the app's session and mirrored to localStorage, so a scroller reopened after a restart also comes
// back where it was.

export interface ScrollPosition {
  top: number;
  /** At the bottom when it was left: shown again, it stays on the latest activity. */
  pinned: boolean;
}

const STORAGE_PREFIX = "chat_scroll_";

/** The scroll key of an agent chat: each chat of a tab keeps its own position. */
export function agentChatScrollKey(chatId: string): string {
  return `agent:${chatId}`;
}

const positions = new Map<string, ScrollPosition>();

/** The position the scroller under `key` was left at, or undefined when it was never scrolled. */
export function recallScroll(key: string): ScrollPosition | undefined {
  const kept = positions.get(key);
  if (kept) return kept;
  const stored = readStored(key);
  if (stored) positions.set(key, stored);
  return stored;
}

/** Records the position at once; `persistScroll` writes it to storage (callers debounce that). */
export function rememberScroll(key: string, position: ScrollPosition): void {
  positions.set(key, position);
}

export function persistScroll(key: string): void {
  const position = positions.get(key);
  if (!position) return;
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(position));
  } catch {
    // Storage full or unavailable: the position is still kept for this session.
  }
}

/** Drops the position of a scroller that is gone for good (its chat was closed). */
export function forgetScroll(key: string): void {
  positions.delete(key);
  try {
    localStorage.removeItem(STORAGE_PREFIX + key);
  } catch {
    // Nothing stored.
  }
}

function readStored(key: string): ScrollPosition | undefined {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_PREFIX + key);
  } catch {
    return undefined;
  }
  if (raw === null || raw.trim() === "") return undefined;
  // Earlier builds stored the offset alone.
  const offset = Number(raw);
  if (Number.isFinite(offset)) return { top: offset, pinned: false };
  try {
    const parsed = JSON.parse(raw) as Partial<ScrollPosition> | null;
    if (typeof parsed?.top === "number" && Number.isFinite(parsed.top)) return { top: parsed.top, pinned: parsed.pinned === true };
  } catch {
    // Not a position: ignored.
  }
  return undefined;
}
