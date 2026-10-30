// ============================================================
// recall/store.ts -- where the full output of a condensed command waits
// until the model asks for it. `RecallStore` is the seam: the app keeps
// one MemoryRecallStore for its whole session (every run and chat turn
// shares it, so an id stays valid after the turn that produced it); a
// store on disk, or one per test, implements the same two methods.
// Bounded by entry count and total size; the least recently used goes.
// ============================================================

import { contentId } from "./contentId";

export const STORE_LIMITS = {
  maxEntries: 30,
  maxTotalChars: 16_000_000,
} as const;

export interface RecallEntry {
  id: string;
  /** The command, as shown in a read's header. */
  label: string;
  /** The filter that condensed it, for the recall rate per filter. */
  source: string;
  text: string;
  /** Read back at least once. */
  recalled: boolean;
}

export interface RecallStore {
  /** Stores `text` and returns its content id; the same text returns the same id. */
  put(entry: { label: string; source: string; text: string }): string;
  get(id: string): RecallEntry | undefined;
}

export class MemoryRecallStore implements RecallStore {
  private readonly entries = new Map<string, RecallEntry>();
  private totalChars = 0;

  put({ label, source, text }: { label: string; source: string; text: string }): string {
    const id = contentId(text);
    const existing = this.entries.get(id);
    if (existing) {
      this.entries.delete(id);
      this.entries.set(id, existing);
      return id;
    }
    this.entries.set(id, { id, label, source, text, recalled: false });
    this.totalChars += text.length;
    while (this.entries.size > STORE_LIMITS.maxEntries || (this.totalChars > STORE_LIMITS.maxTotalChars && this.entries.size > 1)) {
      const oldest = this.entries.values().next().value as RecallEntry;
      this.entries.delete(oldest.id);
      this.totalChars -= oldest.text.length;
    }
    return id;
  }

  get(id: string): RecallEntry | undefined {
    return this.entries.get(id);
  }
}

/** The app session's store. */
export const sessionRecallStore: RecallStore = new MemoryRecallStore();
