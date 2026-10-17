/**
 * Stable identities for canvas nodes. Layout positions and notes are stored against these keys, so
 * they must survive refreshes: a group is identified by its core group id, a file by its
 * root-relative path. Nothing about a key depends on layout or snapshot ids.
 */

export type NodeKey = `group:${string}` | `file:${string}`;

export const groupKey = (groupId: string): NodeKey => `group:${groupId}`;
export const fileKey = (path: string): NodeKey => `file:${path}`;

export type ParsedNodeKey = { type: "group" | "file"; id: string };

export function parseNodeKey(key: string): ParsedNodeKey | null {
  const match = /^(group|file):(.+)$/s.exec(key);
  return match ? { type: match[1] as "group" | "file", id: match[2] } : null;
}

/** True when `value` has the shape of a node key (it may still name a node that no longer exists). */
export function isNodeKey(value: unknown): value is NodeKey {
  return typeof value === "string" && parseNodeKey(value) !== null;
}
