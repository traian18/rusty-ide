// ============================================================
// workingSet/workingSet.ts -- what a chat's agent already explored, carried
// to its next turns. Each message starts a fresh agent session that sees
// the earlier turns' text but none of their tool results, so it explores
// again: lists, searches, reads whole files to find where things are. The
// working set tells it where things are (files read, with lines and what
// for; files edited; searches run), not what they say, so it reads exactly
// what it needs. Kept per chat across restarts, bounded.
// ============================================================

import { persisted } from "../persisted";

export const WORKING_SET_LIMITS = {
  maxFiles: 30,
  maxSearches: 10,
  maxChats: 50,
  /** The section a prompt gets is cut here. */
  maxChars: 2_500,
} as const;

interface FileUse {
  path: string;
  /** What was read: "whole file", "lines 120-160", or "for: <request>". */
  reads: string[];
  edited: boolean;
  at: number;
}

interface SearchUse {
  tool: string;
  query: string;
  at: number;
}

interface ChatSet {
  files: FileUse[];
  searches: SearchUse[];
  at: number;
}

type Sets = Record<string, ChatSet>;

const store = persisted<Sets>("rusty.tokenOptimizations.workingSet.v1", () => ({}), (stored) => (stored && typeof stored === "object" ? (stored as Sets) : {}));

const text = (value: unknown, max = 80): string | undefined => (typeof value === "string" && value.trim() ? value.trim().replace(/\s+/g, " ").slice(0, max) : undefined);

function readLabel(args: Record<string, unknown>): string {
  const start = args.start_line;
  const end = args.end_line;
  if (typeof start === "number" || typeof end === "number") return `lines ${start ?? 1}-${end ?? "end"}`;
  const request = text(args.request, 60);
  return request ? `for: ${request}` : "whole file";
}

const SEARCH_TOOLS: Record<string, string[]> = {
  search_codebase: ["query", "pattern"],
  repo_symbol: ["symbol", "name"],
  repo_context: ["question", "query"],
};

function update(chat: string, change: (set: ChatSet) => void): void {
  const sets = { ...store.get() };
  const set: ChatSet = sets[chat] ? { files: [...sets[chat].files], searches: [...sets[chat].searches], at: Date.now() } : { files: [], searches: [], at: Date.now() };
  change(set);
  set.files = set.files.slice(0, WORKING_SET_LIMITS.maxFiles);
  set.searches = set.searches.slice(0, WORKING_SET_LIMITS.maxSearches);
  sets[chat] = set;
  const chats = Object.entries(sets).sort((a, b) => b[1].at - a[1].at).slice(0, WORKING_SET_LIMITS.maxChats);
  store.set(Object.fromEntries(chats));
}

/** Records one successful tool call of `chat`'s agent. Tools that tell nothing about where things are are ignored. */
export function recordToolUse(chat: string, tool: string, args: unknown): void {
  if (!chat) return;
  const input = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const path = text(input.path, 300);
  if ((tool === "read_file" || tool === "edit_file" || tool === "write_file") && path) {
    update(chat, (set) => {
      // The file touched last goes first: order, not the clock, says what is newest.
      const existing = set.files.find((file) => file.path === path);
      const file = existing ? { ...existing, reads: [...existing.reads] } : { path, reads: [], edited: false, at: 0 };
      set.files = [file, ...set.files.filter((other) => other.path !== path)];
      file.at = Date.now();
      if (tool === "read_file") {
        const label = readLabel(input);
        file.reads = [label, ...file.reads.filter((read) => read !== label)].slice(0, 3);
      } else {
        file.edited = true;
      }
    });
    return;
  }
  const keys = SEARCH_TOOLS[tool];
  const query = keys?.map((key) => text(input[key])).find(Boolean);
  if (query) {
    update(chat, (set) => {
      set.searches = [{ tool, query, at: Date.now() }, ...set.searches.filter((search) => !(search.tool === tool && search.query === query))];
    });
  }
}

/** The section the next turn's prompt gets, or "" when the chat has explored nothing yet. */
export function workingSetSection(chat: string): string {
  const set = store.get()[chat];
  if (!set || (set.files.length === 0 && set.searches.length === 0)) return "";
  const lines = ["## Working set from earlier turns", "What this chat's agent already explored, newest first. Files may have changed since; read only the lines you need instead of exploring again."];
  for (const file of set.files) {
    const parts = [file.edited ? "edited" : undefined, file.reads.length ? `read ${file.reads.join("; ")}` : undefined].filter(Boolean);
    lines.push(`- ${file.path}: ${parts.join("; ")}`);
  }
  if (set.searches.length) lines.push(`Searches already run: ${set.searches.map((search) => `"${search.query}" (${search.tool})`).join(", ")}`);
  let section = lines.join("\n");
  if (section.length > WORKING_SET_LIMITS.maxChars) section = `${section.slice(0, section.lastIndexOf("\n", WORKING_SET_LIMITS.maxChars))}\n- ...`;
  return `${section}\n\n`;
}

export const forgetWorkingSet = (chat: string): void => {
  const sets = { ...store.get() };
  delete sets[chat];
  store.set(sets);
};
