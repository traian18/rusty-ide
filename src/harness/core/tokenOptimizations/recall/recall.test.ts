import { describe, expect, it } from "vitest";
import { contentId, isRecallId } from "./contentId";
import { readEntry } from "./read";
import { MemoryRecallStore, STORE_LIMITS } from "./store";

describe("contentId", () => {
  it("is out- and 16 hex digits, the same for the same text and different otherwise", () => {
    expect(contentId("abc")).toMatch(/^out-[0-9a-f]{16}$/);
    expect(contentId("abc")).toBe(contentId("abc"));
    expect(new Set(Array.from({ length: 2_000 }, (_, i) => contentId(`line ${i}`))).size).toBe(2_000);
    expect(isRecallId(contentId(""))).toBe(true);
    expect(isRecallId("out-1")).toBe(false);
  });
});

describe("MemoryRecallStore", () => {
  it("keeps one copy of the same text and drops the least recently used beyond its limit", () => {
    const store = new MemoryRecallStore();
    const first = store.put({ label: "a", source: "git log", text: "first" });
    expect(store.put({ label: "a again", source: "git log", text: "first" })).toBe(first);
    for (let i = 0; i < STORE_LIMITS.maxEntries - 1; i += 1) store.put({ label: `n${i}`, source: "generic", text: `text ${i}` });
    expect(store.get(first)).toBeDefined();
    store.put({ label: "a", source: "git log", text: "first" });
    store.put({ label: "overflow", source: "generic", text: "one more" });
    expect(store.get(first)).toBeDefined();
    expect(store.get(contentId("text 0"))).toBeUndefined();
  });
});

describe("readEntry", () => {
  const entry = { id: "out-0123456789abcdef", label: "npm test", source: "tests", recalled: false, text: Array.from({ length: 1_000 }, (_, i) => `l${i + 1}`).join("\n") };

  it("reads in pieces of at most 400 lines, saying where to continue", () => {
    const read = readEntry(entry);
    expect(read.ok && read.text.split("\n")[0]).toBe("out-0123456789abcdef (npm test): lines 1-400 of 1000.");
    expect(read.ok && read.text.split("\n").at(-1)).toBe('[more: job_output id="out-0123456789abcdef" start_line=401, or pattern to search]');
    expect(readEntry(entry, { startLine: 2_000 })).toMatchObject({ ok: false });
  });

  it("searches within a line range, and takes an invalid pattern literally", () => {
    const read = readEntry(entry, { pattern: "^l99\\d$", startLine: 995 });
    expect(read.ok && read.text.split("\n").slice(1)).toEqual(["995: l995", "996: l996", "997: l997", "998: l998", "999: l999"]);
    expect(readEntry({ ...entry, text: "a (b\nc" }, { pattern: "(b" })).toEqual({ ok: true, text: "out-0123456789abcdef (npm test): 1 of 2 lines match /(b/.\n1: a (b" });
  });
});
