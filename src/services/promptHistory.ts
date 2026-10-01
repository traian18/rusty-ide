// ============================================================
// promptHistory.ts -- which earlier prompts the chat box offers when the user
// presses the up arrow: the last few they sent, from this chat first and then,
// when this chat has fewer than that, from the chats saved before it.
//
// Pure: the chat tab already reads every saved chat for its history panel, so
// this only decides what to show from what it has.
// ============================================================

/** How many earlier prompts the box offers. */
export const PROMPT_HISTORY_SIZE = 5;

/** A saved chat, reduced to what the history needs. */
export interface PromptSource {
  /** When it was saved; chats without it count as oldest. */
  savedAt?: string;
  /** Its user prompts, oldest first. */
  prompts: string[];
}

interface MessageLike {
  role: string;
  content: string;
}

/** The prompts a person typed in a conversation, oldest first. */
export function userPrompts(messages: readonly MessageLike[]): string[] {
  return messages.filter((message) => message.role === "user").map((message) => message.content);
}

const key = (prompt: string) => prompt.trim();

/**
 * The newest `limit` distinct prompts, newest first, so index 0 is what the
 * person sent last. This chat's prompts come before any saved chat's, and saved
 * chats go newest first. A prompt sent again keeps only its latest place, and
 * blank ones are dropped.
 *
 * `current` is the open chat, which may also be among `previous` (it is saved
 * after every turn): that costs nothing, because the repeat is dropped.
 */
export function recentPrompts(current: readonly string[], previous: readonly PromptSource[], limit: number = PROMPT_HISTORY_SIZE): string[] {
  const ordered = [...previous].sort((a, b) => (b.savedAt ?? "").localeCompare(a.savedAt ?? ""));
  const newestFirst = [current, ...ordered.map((source) => source.prompts)].flatMap((prompts) => [...prompts].reverse());
  const seen = new Set<string>();
  const picked: string[] = [];
  for (const prompt of newestFirst) {
    const id = key(prompt);
    if (id === "" || seen.has(id)) continue;
    seen.add(id);
    picked.push(prompt);
    if (picked.length === limit) break;
  }
  return picked;
}
