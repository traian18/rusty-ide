import { describe, expect, it, vi } from "vitest";
import { createCommandOutputCondenser, MemoryRecallStore, parseStamps, TRUNCATION_MARKER, type CommandRun, type OptimizationId } from "..";
import { OUTPUT_LIMITS } from "./condenser";
import { shapeOutput } from "./pipeline";
import { toInvocation } from "./invocation";
import type { CommandFilter } from "./types";

const run = (program: string, args: string[], output: string, extra: Partial<CommandRun> = {}): CommandRun => ({ program, args, exitCode: 0, output, ...extra });

const longLog = Array.from({ length: 80 }, (_, i) => `commit ${String(i).padStart(7, "0")}abcdef\nAuthor: A <a@x>\nDate:   Fri Oct 30 17:31:56 2026 +0200\n\n    Subject ${i}\n`).join("\n");

function condenser(off: OptimizationId[] = []) {
  const onCondensed = vi.fn();
  const onRecalled = vi.fn();
  const outputs = createCommandOutputCondenser({ store: new MemoryRecallStore(), isEnabled: (id) => !off.includes(id), onCondensed, onRecalled });
  return { outputs, onCondensed, onRecalled };
}

describe("condense", () => {
  it("returns short output that no filter changes as it was, without a stamp", () => {
    const { outputs } = condenser();
    expect(outputs.condense(run("echo", ["hi"], "hi\n"))).toMatchObject({ text: "hi\n", filter: "generic", recallId: undefined, summary: undefined });
  });

  it("keeps the full output of a long condensed result under a content id and ends with a stamp naming it", () => {
    const { outputs, onCondensed } = condenser();
    const condensed = outputs.condense(run("git", ["log"], longLog));
    expect(condensed.filter).toBe("git log");
    expect(condensed.recallId).toMatch(/^out-[0-9a-f]{16}$/);
    const [stamp] = parseStamps(condensed.text);
    expect(stamp).toEqual({ action: "condensed", method: "git-log", rawChars: longLog.length, shownChars: condensed.text.length - condensed.text.split("\n").at(-1)!.length - 1, recallId: condensed.recallId });
    expect(condensed.text.split("\n").at(-1)).toMatch(/^\[rusty:condensed git-log · [\d,]+->[\d,]+ chars · full output: job_output id="out-[0-9a-f]{16}" \(add pattern, or start_line and end_line, to read part\)\]$/);
    expect(onCondensed).toHaveBeenCalledWith("git log", longLog.length, condensed.text.length, true);
    expect(outputs.owns(condensed.recallId!)).toBe(true);
    expect(outputs.owns("job-1")).toBe(false);
  });

  it("gives the same output the same id, run after run", () => {
    const { outputs } = condenser();
    expect(outputs.condense(run("git", ["log"], longLog)).recallId).toBe(outputs.condense(run("git", ["log"], longLog)).recallId);
    expect(outputs.condense(run("git", ["log"], `${longLog}\n`)).recallId).not.toBe(outputs.condense(run("git", ["log"], longLog)).recallId);
  });

  it("reads kept output back by range and pattern, and counts a read once per output", () => {
    const { outputs, onRecalled } = condenser();
    const { recallId } = outputs.condense(run("git", ["log"], longLog));
    expect(outputs.recall(recallId!, { startLine: 2, endLine: 3 })).toEqual({
      ok: true,
      text: `${recallId} (git log): lines 2-3 of 480.\n2: Author: A <a@x>\n3: Date:   Fri Oct 30 17:31:56 2026 +0200\n[more: job_output id="${recallId}" start_line=4, or pattern to search]`,
    });
    const search = outputs.recall(recallId!, { pattern: "subject 7\\d$" });
    expect(search.ok && search.text.split("\n")[0]).toBe(`${recallId} (git log): 10 of 480 lines match /subject 7\\d$/.`);
    expect(onRecalled).toHaveBeenCalledTimes(1);
    expect(onRecalled).toHaveBeenCalledWith("git log");
    expect(outputs.recall("out-0000000000000000")).toMatchObject({ ok: false, error: expect.stringContaining("No stored output") });
  });

  it("stamps without keeping when the caller's model cannot recall, or recall is switched off", () => {
    const notRecallable = condenser().outputs.condense(run("git", ["log"], longLog, { recallable: false }));
    expect(notRecallable.recallId).toBeUndefined();
    const stamps = parseStamps(notRecallable.text);
    expect(stamps.map((stamp) => [stamp.method, stamp.recallId])).toEqual([["git-log", undefined]]);
    expect(notRecallable.text).not.toContain("job_output");
    expect(condenser(["recall"]).outputs.condense(run("git", ["log"], longLog)).recallId).toBeUndefined();
  });

  it("passes output through when condensing is off, asked for raw, or already stamped", () => {
    const off = condenser(["command-output"]).outputs.condense(run("git", ["log"], `\u001b[33m${longLog}`));
    expect(off).toMatchObject({ text: longLog, filter: "off" });
    expect(condenser().outputs.condense(run("git", ["log"], longLog, { raw: true }))).toMatchObject({ text: longLog, filter: "raw" });
    const once = condenser().outputs.condense(run("git", ["log"], longLog)).text;
    expect(condenser().outputs.condense(run("cat", ["log.txt"], once))).toMatchObject({ text: once, filter: "stamped" });
  });

  it("fits any output to the budget, keeping the tail", () => {
    const { outputs } = condenser();
    const huge = "x".repeat(OUTPUT_LIMITS.maxChars + 10);
    const fitted = outputs.condense(run("cat", ["big"], huge, { raw: true })).text;
    expect(fitted.startsWith(`${TRUNCATION_MARKER}\n`)).toBe(true);
    expect(fitted.length).toBe(OUTPUT_LIMITS.maxChars + TRUNCATION_MARKER.length + 1);
    expect(outputs.condense(run("cat", ["x"], "tail\n", { raw: true, captureTruncated: true })).text).toBe(`${TRUNCATION_MARKER}\ntail\n`);
  });

  it("windows a very long output of any command, head small and tail large", () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join("\n");
    const condensed = condenser().outputs.condense(run("some-tool", [], lines));
    expect(condensed.text).toContain("[... 750 lines omitted ...]");
    expect(condensed.text.split("\n").slice(0, 50).at(-1)).toBe("line 49");
    expect(condensed.text).toContain("line 999");
  });

  it("reads a plain sh -c line as its own command, and a pipeline generically", () => {
    const { outputs } = condenser();
    expect(outputs.condense(run("sh", ["-c", "git log"], longLog)).filter).toBe("git log");
    expect(outputs.condense(run("sh", ["-c", "git log | head -500"], longLog)).filter).toBe("generic");
  });
});

describe("shape", () => {
  it("only shapes: no stamp, nothing kept", () => {
    const { outputs, onCondensed } = condenser();
    const shaped = outputs.shape({ program: "cargo", args: ["test"], exitCode: 0, output: "test a ... ok\ntest b ... FAILED\ntest result: FAILED. 1 passed; 1 failed;" });
    expect(shaped).toBe("test b ... FAILED\ntest result: FAILED. 1 passed; 1 failed;");
    expect(onCondensed).not.toHaveBeenCalled();
    expect(condenser(["command-output"]).outputs.shape({ program: "cargo", args: ["test"], exitCode: 0, output: "test a ... ok" })).toBe("test a ... ok");
  });
});

describe("shapeOutput", () => {
  const command = toInvocation("tool", [], 0);
  const filter = (apply: CommandFilter["apply"]): CommandFilter[] => [{ name: "test", matches: () => true, apply }];

  it("fails open when a filter throws or does not recognise the output", () => {
    expect(shapeOutput(command, "a\nb", filter(() => { throw new Error("bug"); }))).toMatchObject({ text: "a\nb", filter: "generic" });
    expect(shapeOutput(command, "a\nb", filter(() => undefined))).toMatchObject({ text: "a\nb", filter: "generic" });
    expect(shapeOutput(command, "a\nb", [{ name: "x", matches: () => { throw new Error("bug"); }, apply: () => "" }])).toMatchObject({ text: "a\nb", filter: "generic" });
  });

  it("is never worse than the command's own output", () => {
    expect(shapeOutput(command, "short", filter(() => "much longer than the input"))).toMatchObject({ text: "short", filter: "none" });
  });

  it("says so when a filter left nothing", () => {
    const progress = Array.from({ length: 20 }, (_, i) => `downloading part ${i}`).join("\n");
    expect(shapeOutput(command, progress, filter(() => "")).text).toBe("(test: nothing but progress and noise; 20 lines left out)");
  });

  it("strips ANSI codes and keeps the last frame of redrawn lines before any filter runs", () => {
    expect(shapeOutput(command, "\u001b[32mok\u001b[0m\n10%\r50%\r100%\ndone", []).text).toBe("ok\n100%\ndone");
  });

  it("collapses only identical adjacent lines, and clips very long ones", () => {
    expect(shapeOutput(command, "a\nsame\nsame\nsame\nb\nsame", []).text).toBe("a\nsame\n[x3]\nb\nsame");
    expect(shapeOutput(command, "y".repeat(2100), []).text).toBe(`${"y".repeat(2000)}… [+100 chars]`);
  });
});
