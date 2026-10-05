import type { Message } from "./Chat";

export interface ChatSearchMatch {
  messageId: string;
  messageIndex: number;
  occurrence: number;
  start: number;
  end: number;
}

interface IndexedMessage {
  content: string;
  normalized: string;
  starts: number[];
  ends: number[];
}

export interface ChatSearchIndex {
  messages: Map<string, IndexedMessage>;
}

let normalizationCount = 0;

export function resetChatSearchInstrumentation(): void {
  normalizationCount = 0;
}

export function getChatSearchNormalizationCount(): number {
  return normalizationCount;
}

function normalizeWithMap(value: string, count = true): IndexedMessage {
  if (count) normalizationCount += 1;
  let normalized = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let pendingSpace: { start: number; end: number } | undefined;

  for (let offset = 0; offset < value.length;) {
    const codePoint = value.codePointAt(offset)!;
    const sourceEnd = offset + (codePoint > 0xffff ? 2 : 1);
    const character = value.slice(offset, sourceEnd);
    if (/[\p{P}\p{S}\s\u200b]/u.test(character)) {
      if (normalized && !pendingSpace) pendingSpace = { start: offset, end: sourceEnd };
    } else {
      if (pendingSpace) {
        normalized += " ";
        starts.push(pendingSpace.start);
        ends.push(pendingSpace.end);
        pendingSpace = undefined;
      }
      const lowered = character.toLocaleLowerCase();
      for (const loweredCharacter of lowered) {
        normalized += loweredCharacter;
        starts.push(offset);
        ends.push(sourceEnd);
      }
    }
    offset = sourceEnd;
  }
  return { content: value, normalized, starts, ends };
}

/** Normalize text for predictable, case-insensitive literal phrase matching. */
export function normalizeChatSearchText(value: string): string {
  return normalizeWithMap(value, false).normalized;
}

export function createChatSearchIndex(messages: Message[], previous?: ChatSearchIndex): ChatSearchIndex {
  const indexed = new Map<string, IndexedMessage>();
  for (const message of messages) {
    if (message.role === "console") continue;
    const cached = previous?.messages.get(message.id);
    indexed.set(message.id, cached?.content === message.content ? cached : normalizeWithMap(message.content));
  }
  return { messages: indexed };
}

export function findChatSearchMatches(messages: Message[], query: string, index?: ChatSearchIndex): ChatSearchMatch[] {
  const normalizedQuery = normalizeChatSearchText(query);
  if (!normalizedQuery) return [];
  const searchIndex = index ?? createChatSearchIndex(messages);
  const matches: ChatSearchMatch[] = [];
  messages.forEach((message, messageIndex) => {
    if (message.role === "console") return;
    const content = searchIndex.messages.get(message.id);
    if (!content) return;
    let from = 0;
    let occurrence = 0;
    while (from <= content.normalized.length - normalizedQuery.length) {
      const start = content.normalized.indexOf(normalizedQuery, from);
      if (start < 0) break;
      const last = start + normalizedQuery.length - 1;
      matches.push({ messageId: message.id, messageIndex, occurrence, start: content.starts[start], end: content.ends[last] });
      occurrence += 1;
      from = start + 1;
    }
  });
  return matches;
}
