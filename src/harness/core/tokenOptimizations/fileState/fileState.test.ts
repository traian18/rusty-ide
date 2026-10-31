import { describe, expect, it, vi } from "vitest";
import { MemoryRecallStore } from "..";
import { ToolOutputOptimizer } from "../toolOutput/optimizer";
import { changedRegion, describeEdit } from "./region";
import { changeSinceLastRead, parseRead } from "./rereads";

const lines = (n: number, edit?: (i: number) => string | undefined) => Array.from({ length: n }, (_, i) => edit?.(i) ?? `fn line_${i + 1}() {}`);
const read = (path: string, body: string[], start = 1) => `File: ${path} (${body.length + start - 1} lines)\n[lines ${start}-${body.length + start - 1}]\n${body.join("\n")}`;

describe("changedRegion", () => {
  it("finds the span between the first and last changed line", () => {
    expect(changedRegion(["a", "b", "c"], ["a", "B", "c"])).toEqual({ start: 1, endBefore: 2, endAfter: 2 });
    expect(changedRegion(["a", "c"], ["a", "b", "c"])).toEqual({ start: 1, endBefore: 1, endAfter: 2 });
    expect(changedRegion(["a"], ["a"])).toBeUndefined();
  });
});

describe("describeEdit", () => {
  it("shows the changed lines with three around them, numbered", () => {
    const before = lines(20).join("\n");
    const after = lines(20, (i) => (i === 9 ? "fn changed() {}" : undefined)).join("\n");
    expect(describeEdit(before, after)).toBe(`\nThe file now has 20 lines. Lines 7-13 now read:\n${[7, 8, 9].map((n) => `${n}: fn line_${n}() {}`).join("\n")}\n10: fn changed() {}\n${[11, 12, 13].map((n) => `${n}: fn line_${n}() {}`).join("\n")}`);
  });

  it("caps a very large change to head and tail", () => {
    const out = describeEdit("x", lines(500).join("\n"));
    expect(out).toContain("[... ");
    expect(out.split("\n").length).toBeLessThan(70);
  });
});

describe("re-reads", () => {
  it("parse the exact-range format and ignore anything else", () => {
    expect(parseRead(read("a.rs", ["x", "y"]))).toMatchObject({ path: "a.rs", total: 2, start: 1, lines: ["x", "y"] });
    expect(parseRead("some excerpt")).toBeUndefined();
  });

  it("answer a re-read of an edited file with the change, numbered as the file is now", () => {
    const before = read("policy.rs", lines(200));
    const after = read("policy.rs", lines(200, (i) => (i === 142 ? "    let pressure = reading(); // changed" : undefined)));
    const change = changeSinceLastRead(before, after, "out-0000000000000001")!;
    expect(change).toContain("[Changed since this session last read it; every other line is as it was then. Lines 140-146 now read:]");
    expect(change).toContain("143:     let pressure = reading(); // changed");
    expect(change).toContain('job_output id="out-0000000000000001"');
    expect(change.length).toBeLessThan(after.length / 5);
  });

  it("send the whole file when most of it changed, or the reads are not comparable", () => {
    expect(changeSinceLastRead(read("a.rs", lines(200)), read("a.rs", lines(200, () => "new"))!, "out-1")).toBeUndefined();
    expect(changeSinceLastRead(read("a.rs", lines(10)), read("b.rs", lines(10)), "out-1")).toBeUndefined();
  });
});

describe("the optimizer with file memory", () => {
  it("answers a session's re-read after its own edit with only the change, and keeps the whole file recallable", async () => {
    const store = new MemoryRecallStore();
    const optimizer = new ToolOutputOptimizer({ store, isEnabled: () => true, onCondensed: vi.fn() });
    let file = read("policy.rs", lines(300));
    const readFile = optimizer.wrap("read_file", vi.fn(async () => ({ ok: true as const, output: file })));
    const signal = new AbortController().signal;
    await readFile({ path: "policy.rs", request: "the reading function" }, signal, undefined, { sessionId: "s" });
    file = read("policy.rs", lines(300, (i) => (i === 10 ? "fn edited() {}" : undefined)));
    const again = String(((await readFile({ path: "policy.rs", request: "check my edit" }, signal, undefined, { sessionId: "s" })) as { output: string }).output);
    expect(again).toContain("11: fn edited() {}");
    expect(again.length).toBeLessThan(file.length / 10);
    const id = /job_output id="(out-[0-9a-f]{16})"/.exec(again)![1];
    expect(store.get(id)?.text).toBe(file);
    // Another session has never read it, so it gets the whole file.
    expect(await readFile({ path: "policy.rs" }, signal, undefined, { sessionId: "other" })).toEqual({ ok: true, output: file });
  });
});
