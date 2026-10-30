/** The change the person picked as the one their chats are about, per repository. Kept in this browser only. */
import { create } from "zustand";

const KEY = "rusty.activeSpecChange";

function load(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function save(value: Record<string, string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Not remembered across restarts; the choice still holds for this session.
  }
}

interface ActiveChangeState {
  /** The active change folder name by repository root. */
  byRoot: Record<string, string>;
  set(root: string, change: string | null): void;
}

export const useActiveSpecChange = create<ActiveChangeState>()((set, get) => ({
  byRoot: load(),
  set: (root, change) => {
    const next = { ...get().byRoot };
    if (change) next[root] = change;
    else delete next[root];
    save(next);
    set({ byRoot: next });
  },
}));

/** The active change of a repository, or null. */
export function activeSpecChange(root: string): string | null {
  return useActiveSpecChange.getState().byRoot[root] ?? null;
}
