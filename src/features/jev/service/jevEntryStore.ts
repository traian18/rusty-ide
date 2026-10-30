type Listener = () => void;

type EntryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const MAX_ENTRIES = 5000;

/** A persisted, subscribable list of JEV results, one entry per scored item. */
export class JevEntryStore<T extends { id: string }> {
  private entries: T[] | undefined;
  private listeners = new Set<Listener>();
  private saveTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private storageKey: string,
    private storage: EntryStorage | undefined = typeof localStorage === "undefined" ? undefined : localStorage,
  ) {}

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getEntries = (): T[] => this.load();

  /** Adds or merges into the entry with the same id. */
  update(id: string, patch: Partial<T>, create?: Omit<T, "id">): void {
    const entries = this.load();
    const index = entries.findIndex((entry) => entry.id === id);
    if (index >= 0) {
      entries[index] = { ...entries[index], ...patch };
    } else if (create) {
      entries.push({ ...create, ...patch, id } as T);
      if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    } else {
      return;
    }
    this.entries = [...entries];
    this.changed();
  }

  clear(): void {
    this.entries = [];
    try {
      this.storage?.removeItem(this.storageKey);
    } catch {
      // Storage unavailable: the in-memory list is already empty.
    }
    this.notify();
  }

  private load(): T[] {
    if (this.entries) return this.entries;
    try {
      const parsed = JSON.parse(this.storage?.getItem(this.storageKey) || "[]") as unknown;
      this.entries = Array.isArray(parsed) ? parsed as T[] : [];
    } catch {
      this.entries = [];
    }
    return this.entries;
  }

  private changed(): void {
    this.notify();
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      try {
        this.storage?.setItem(this.storageKey, JSON.stringify(this.entries ?? []));
      } catch (error) {
        console.warn("JEV results could not be saved:", error);
      }
    }, 500);
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }
}
