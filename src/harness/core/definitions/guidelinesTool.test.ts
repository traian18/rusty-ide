import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { codeGuidelinesTool, guidelineBrief, guidelineNotice, newGuidelineBriefs, withGuidelineNotices, workspaceRelative } from "./guidelinesTool";

const signal = {} as never;

const violations = (errors: number, list: Array<{ severity: string; rule: string }>) => ({
  result: {
    status: errors > 0 ? "violations" : "ok",
    summary: `${errors} error(s)`,
    sections: { errors, warnings: list.length - errors, files: [{ path: "src/a.rs", violations: list.map((v) => ({ ...v, lines: "3", message: "no" })) }] },
  },
});

describe("code_guidelines", () => {
  beforeEach(() => invoke.mockReset());

  it("passes model calls through to the host", async () => {
    invoke.mockResolvedValue({ result: { status: "ok", summary: "2 rules" }, repository: { name: "api" } });
    const result = await codeGuidelinesTool("/ws", "/ws/api", new Set())({ mode: "rules", targets: ["src/a.rs"] }, signal);
    expect(invoke).toHaveBeenCalledWith("repository_agent_tool", { root: "/ws", activeRepository: "/ws/api", tool: "code_guidelines", arguments: { mode: "rules", targets: ["src/a.rs"] } });
    expect(result).toEqual({ ok: true, output: JSON.stringify({ status: "ok", summary: "2 rules", repository: { name: "api" } }) });
  });

  it("as the gate, checks what the run changed and fails only on errors it introduced", async () => {
    const changed = new Set(["/ws/src/a.rs"]);
    invoke.mockResolvedValue(violations(1, [{ severity: "error", rule: "no-unwrap" }, { severity: "warn", rule: "no-todo" }]));
    const failed = await codeGuidelinesTool("/ws", undefined, changed)({ gate: true }, signal);
    expect(invoke).toHaveBeenCalledWith("repository_agent_tool", expect.objectContaining({ arguments: { mode: "check", targets: ["src/a.rs"], changed_only: true } }));
    expect(failed.ok).toBe(false);
    expect(!failed.ok && failed.error).toContain("src/a.rs:3 [no-unwrap]");
    expect(!failed.ok && failed.error).not.toContain("no-todo");

    invoke.mockResolvedValue(violations(0, [{ severity: "warn", rule: "no-todo" }]));
    expect((await codeGuidelinesTool("/ws", undefined, changed)({ gate: true }, signal)).ok).toBe(true);
    invoke.mockResolvedValue({ result: { status: "not_configured", summary: "none" } });
    expect((await codeGuidelinesTool("/ws", undefined, changed)({ gate: true }, signal)).ok).toBe(true);
  });

  it("as the gate, passes without asking the host when the run changed nothing", async () => {
    expect((await codeGuidelinesTool("/ws", undefined, new Set())({ gate: true }, signal)).ok).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("counts errors across repositories when the paths were split", async () => {
    invoke.mockResolvedValue({ result: { status: "ok", split: "…", sections: { api: violations(1, [{ severity: "error", rule: "r" }]).result, web: violations(0, []).result } } });
    expect((await codeGuidelinesTool("/ws", undefined, new Set(["/ws/api/a.rs", "/ws/web/b.ts"]))({ gate: true }, signal)).ok).toBe(false);
  });
});

describe("edit notices", () => {
  beforeEach(() => invoke.mockReset());

  it("appends what an edit introduced to its result, and nothing when it is clean", async () => {
    const edit = vi.fn().mockResolvedValue({ ok: true, output: "Edited /ws/src/a.rs" });
    invoke.mockResolvedValue(violations(1, [{ severity: "error", rule: "no-unwrap" }]));
    const result = await withGuidelineNotices(edit, "/ws", undefined)({ path: "/ws/src/a.rs" }, signal);
    expect(invoke).toHaveBeenCalledWith("repository_agent_tool", expect.objectContaining({ arguments: { mode: "check", targets: ["src/a.rs"], changed_only: true } }));
    expect(result.ok && result.output).toContain("Guidelines: this edit introduced 1 error(s)");

    invoke.mockResolvedValue(violations(0, []));
    expect(await withGuidelineNotices(edit, "/ws", undefined)({ path: "src/a.rs" }, signal)).toEqual({ ok: true, output: "Edited /ws/src/a.rs" });
  });

  it("tells the first edit to a file which guidelines apply, once per set in a run", async () => {
    const applies = { result: { status: "ok", sections: { files: [{ path: "src/a.rs", rules: [{ id: "no-unwrap", severity: "error", message: "no unwrap outside tests" }], style: ["# Good Rust\n## 1. Ownership\n```bash\n# not a heading\n```\n## 2. Errors\nmore"] }] } } };
    const mode = (call: unknown) => (call as { arguments?: { mode?: string } } | undefined)?.arguments?.mode;
    invoke.mockImplementation((_cmd: string, call: unknown) => Promise.resolve(mode(call) === "rules" ? applies : violations(0, [])));
    const edit = vi.fn().mockResolvedValue({ ok: true, output: "Edited" });
    const tool = withGuidelineNotices(edit, "/ws", undefined, newGuidelineBriefs());
    const first = await tool({ path: "/ws/src/a.rs" }, signal);
    expect(first.ok && first.output).toContain("Guidelines for src/a.rs");
    expect(first.ok && first.output).toContain("- error [no-unwrap]: no unwrap outside tests");
    expect(first.ok && first.output).toContain("Style guide: Good Rust; 1. Ownership; 2. Errors");
    // The same file again, and another file with the same guidelines: not repeated.
    expect(await tool({ path: "/ws/src/a.rs" }, signal)).toEqual({ ok: true, output: "Edited" });
    expect(await tool({ path: "/ws/src/b.rs" }, signal)).toEqual({ ok: true, output: "Edited" });
    expect(invoke.mock.calls.filter(([, call]) => mode(call) === "rules")).toHaveLength(2);
  });

  it("has no brief when nothing applies or the project has no guidelines", () => {
    expect(guidelineBrief({ status: "not_configured" })).toBeUndefined();
    expect(guidelineBrief({ status: "ok", sections: { files: [{ path: "a.rs", rules: [], style: [] }] } })).toBeUndefined();
  });

  it("leaves a failed edit alone", async () => {
    const edit = vi.fn().mockResolvedValue({ ok: false, error: "no match" });
    expect(await withGuidelineNotices(edit, "/ws", undefined)({ path: "a.rs" }, signal)).toEqual({ ok: false, error: "no match" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("lists at most three violations", () => {
    const notice = guidelineNotice(violations(0, ["a", "b", "c", "d"].map((rule) => ({ severity: "warn", rule }))).result);
    expect(notice).toContain("introduced warnings");
    expect(notice).toContain("and 1 more");
  });

  it("turns absolute paths into workspace-relative ones", () => {
    expect(workspaceRelative("/ws/", "/ws/src/a.rs")).toBe("src/a.rs");
    expect(workspaceRelative("/ws", "src/a.rs")).toBe("src/a.rs");
    expect(workspaceRelative("/ws", "/other/a.rs")).toBe("/other/a.rs");
  });
});
