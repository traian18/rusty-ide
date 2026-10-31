import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetWorkingSet, noteToolUse, workingSetFor, WORKING_SET_LIMITS } from ".";
import { setOptimizationEnabled } from "../switches";
import { ToolOutputOptimizer } from "../toolOutput/optimizer";
import { MemoryRecallStore } from "../recall/store";

afterEach(() => {
  forgetWorkingSet("chat-1");
  forgetWorkingSet("chat-2");
  setOptimizationEnabled("working-set", true);
});

describe("working set", () => {
  it("lists what a chat read, edited and searched, newest first", () => {
    noteToolUse("chat-1", "read_file", { path: "src/a.rs", request: "the reading function" });
    noteToolUse("chat-1", "search_codebase", { query: "context pressure" });
    noteToolUse("chat-1", "read_file", { path: "src/b.rs", start_line: 120, end_line: 160 });
    noteToolUse("chat-1", "edit_file", { path: "src/b.rs", old_string: "x", new_string: "y" });
    const section = workingSetFor("chat-1");
    expect(section.split("\n").slice(0, 5)).toEqual([
      "## Working set from earlier turns",
      "What this chat's agent already explored, newest first. Files may have changed since; read only the lines you need instead of exploring again.",
      "- src/b.rs: edited; read lines 120-160",
      "- src/a.rs: read for: the reading function",
      'Searches already run: "context pressure" (search_codebase)',
    ]);
    expect(workingSetFor("chat-2")).toBe("");
  });

  it("stays within its limits", () => {
    for (let i = 0; i < 60; i += 1) noteToolUse("chat-1", "read_file", { path: `src/file_${i}_${"x".repeat(80)}.rs` });
    const section = workingSetFor("chat-1");
    expect(section.length).toBeLessThanOrEqual(WORKING_SET_LIMITS.maxChars + 10);
    expect(section).toContain("file_59");
    expect(section).not.toContain("file_0_");
  });

  it("records nothing and adds nothing when switched off", () => {
    setOptimizationEnabled("working-set", false);
    noteToolUse("chat-1", "read_file", { path: "src/a.rs" });
    setOptimizationEnabled("working-set", true);
    expect(workingSetFor("chat-1")).toBe("");
  });

  it("is fed by the tool wrap point, for successful calls only", async () => {
    const optimizer = new ToolOutputOptimizer({ store: new MemoryRecallStore(), isEnabled: () => true, onCondensed: vi.fn() });
    const signal = new AbortController().signal;
    await optimizer.wrap("edit_file", vi.fn(async () => ({ ok: true as const, output: "Edited" })), "chat-1")({ path: "src/c.rs" }, signal);
    await optimizer.wrap("edit_file", vi.fn(async () => ({ ok: false as const, error: "no" })), "chat-1")({ path: "src/failed.rs" }, signal);
    const section = workingSetFor("chat-1");
    expect(section).toContain("- src/c.rs: edited");
    expect(section).not.toContain("failed.rs");
  });
});
