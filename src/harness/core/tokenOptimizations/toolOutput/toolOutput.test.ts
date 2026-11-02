import type { ToolHandlerLike } from "../toolOutput/optimizer";
import { describe, expect, it, vi } from "vitest";
import { MemoryRecallStore, type OptimizationId } from "..";
import { parseStamps } from "../safeguards/stamps";
import { ToolOutputOptimizer, TOOL_OUTPUT_LIMITS } from "./optimizer";

const signal = new AbortController().signal;
const file = Array.from({ length: 60 }, (_, i) => `line ${i} of policy.rs`).join("\n");

function setup(off: OptimizationId[] = []) {
  const store = new MemoryRecallStore();
  const onCondensed = vi.fn();
  const optimizer = new ToolOutputOptimizer({ store, isEnabled: (id) => !off.includes(id), onCondensed });
  return { optimizer, store, onCondensed };
}

const tool = (output: () => string) => vi.fn(async (..._args: Parameters<ToolHandlerLike>) => ({ ok: true as const, output: output() }));

describe("repeat-results", () => {
  it("points at a file the same session already read, unchanged, and keeps it recallable", async () => {
    const { optimizer, store, onCondensed } = setup();
    const read = optimizer.wrap("read_file", tool(() => file));
    const first = await read({ path: "policy.rs" }, signal, undefined, { sessionId: "s1" });
    expect(first).toEqual({ ok: true, output: file });
    const again = await read({ path: "policy.rs" }, signal, undefined, { sessionId: "s1" });
    const id = /job_output id="(out-[0-9a-f]{16})"/.exec(String((again as { output: string }).output))?.[1];
    expect(String((again as { output: string }).output)).toMatch(/^\[unchanged since this session last received it/);
    expect(store.get(id!)?.text).toBe(file);
    expect(onCondensed).toHaveBeenCalledWith("repeat read_file", file.length, expect.any(Number), true);
  });

  it("resends a changed file, other lines of it, and anything to another session", async () => {
    const { optimizer } = setup();
    let content = file;
    const read = optimizer.wrap("read_file", tool(() => content));
    await read({ path: "policy.rs" }, signal, undefined, { sessionId: "s1" });
    expect((await read({ path: "policy.rs" }, signal, undefined, { sessionId: "s2" })) as { output: string }).toMatchObject({ output: file });
    expect((await read({ path: "policy.rs", start_line: 1 }, signal, undefined, { sessionId: "s1" })) as { output: string }).toMatchObject({ output: file });
    content = `${file}\nedited`;
    expect((await read({ path: "policy.rs" }, signal, undefined, { sessionId: "s1" })) as { output: string }).toMatchObject({ output: content });
  });

  it("replaces only the spec documents already received, keeping status and open tasks", async () => {
    const { optimizer } = setup();
    const design = `## design (.rusty/specs/changes/0001-x/design.md)\n\n${"Design text.\n".repeat(60)}`;
    let tasks = "Open tasks:\n- [ ] T2";
    const spec = optimizer.wrap("spec_context", tool(() => `Change 0001 X: building, tasks 1/11.\n\n${tasks}\n\n${design}`));
    await spec({ change: "0001" }, signal, undefined, { sessionId: "s" });
    tasks = "Open tasks:\n- [ ] T3";
    const again = String(((await spec({ change: "0001", documents: ["design"] }, signal, undefined, { sessionId: "s" })) as { output: string }).output);
    expect(again).toContain("- [ ] T3");
    expect(again).toContain("## design (.rusty/specs/changes/0001-x/design.md)\n\n[unchanged since this session last received it");
    expect(again).not.toContain("Design text.");
  });

  it("leaves short parts, failures, other tools and switched-off sessions alone", async () => {
    const { optimizer } = setup(["repeat-results"]);
    const read = optimizer.wrap("read_file", tool(() => file));
    await read({ path: "a" }, signal);
    expect(await read({ path: "a" }, signal)).toEqual({ ok: true, output: file });
    const short = setup().optimizer.wrap("read_file", tool(() => "tiny"));
    await short({ path: "a" }, signal);
    expect(await short({ path: "a" }, signal)).toEqual({ ok: true, output: "tiny" });
    const edit = vi.fn(async (..._args: Parameters<ToolHandlerLike>) => ({ ok: true as const, output: "ok" }));
    expect(setup().optimizer.wrap("edit_file", edit)).toBe(edit);
  });
});

describe("tool-output-limits", () => {
  it("cuts a very large report to head and tail with a stamp naming the full text", async () => {
    const { optimizer, store } = setup();
    const report = Array.from({ length: 2_000 }, (_, i) => `entry ${i}`).join("\n");
    const out = String(((await optimizer.wrap("repo_context", tool(() => report))({}, signal)) as { output: string }).output);
    expect(out.length).toBeLessThan(TOOL_OUTPUT_LIMITS.maxChars);
    expect(out.startsWith("entry 0\n")).toBe(true);
    expect(out).toContain("entry 1999");
    const [stamp] = parseStamps(out);
    expect(stamp.method).toBe("repo-context");
    expect(store.get(stamp.recallId!)?.text).toBe(report);
  });

  it("never cuts a file read", async () => {
    const big = "x\n".repeat(20_000);
    expect(await setup().optimizer.wrap("read_file", tool(() => big))({ path: "big" }, signal)).toEqual({ ok: true, output: big });
  });
});
