// ============================================================
// recall/contentId.ts -- the id of a stored output is a hash of its
// content, not a counter. The same output always gets the same id, so a
// result that is resent or produced again reads the same, and storing it
// twice keeps one copy. Synchronous on purpose: condensing runs inside a
// tool call and must not wait. 64 bits from two seeded cyrb53 hashes are
// plenty for an in-memory store of a few dozen entries.
// ============================================================

export const RECALL_PREFIX = "out-";

function cyrb53(text: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

const hex8 = (value: number) => (value % 0x100000000).toString(16).padStart(8, "0");

/** `out-` and 16 hex digits, a pure function of `text`. */
export function contentId(text: string): string {
  return `${RECALL_PREFIX}${hex8(cyrb53(text, 0x9e3779b1))}${hex8(cyrb53(text, 0x85ebca6b))}`;
}

export const isRecallId = (id: string): boolean => /^out-[0-9a-f]{16}$/.test(id);
