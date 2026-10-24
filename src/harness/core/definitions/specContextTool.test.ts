import { describe, expect, it, vi } from "vitest";

import { change, emptyOverview, fakeSpecsClient } from "../../../specs/specs.testing";
import { activeSpecBrief } from "../../../specs/activeBrief";
import { findChange, specContextTool } from "./specContextTool";

const overview = { ...emptyOverview, exists: true, changes: [change(), change({ dir: "0002-dark-mode", number: 2, title: "Dark mode", status: "draft" })] };
const client = (documents: Record<string, string> = {}) =>
  fakeSpecsClient({
    overview: vi.fn(async () => overview),
    document: vi.fn(async (_root: string, path: string) => documents[path] ?? null),
    tasks: vi.fn(async () => [{ id: "T1", title: "Model", done: false, line: 1, requirements: ["R1"], criteria: ["C1"], after: [], instructions: "" }]),
  });

describe("spec_context", () => {
  it("finds a change by folder, number or part of its title", () => {
    expect(findChange(overview.changes, "0002-dark-mode")?.dir).toBe("0002-dark-mode");
    expect(findChange(overview.changes, "2")?.dir).toBe("0002-dark-mode");
    expect(findChange(overview.changes, "dark")?.dir).toBe("0002-dark-mode");
    expect(findChange(overview.changes, "nothing")).toBeUndefined();
    expect(findChange(overview.changes, " ")).toBeUndefined();
  });

  it("lists the specs with no input", async () => {
    const result = await specContextTool("/repo", client())({});
    expect(result).toMatchObject({ ok: true });
    expect((result as { output: string }).output).toContain("change 0002-dark-mode");
  });

  it("returns one change with its spec and design by default", async () => {
    const docs = client({ "specs/changes/0001-albums/spec.md": "# The spec", "specs/changes/0001-albums/design.md": "# The design" });
    const result = (await specContextTool("/repo", docs)({ change: "albums" })) as { ok: boolean; output: string };
    expect(result.ok).toBe(true);
    expect(result.output).toContain("# The spec");
    expect(result.output).toContain("# The design");
    expect(result.output).toContain("- T1 Model");
    const only = (await specContextTool("/repo", docs)({ change: "1", documents: ["design", "bogus"] })) as { output: string };
    expect(only.output).toContain("# The design");
    expect(only.output).not.toContain("# The spec");
  });

  it("names the changes there are when none matches, and fails without a workspace", async () => {
    const missing = (await specContextTool("/repo", client())({ change: "zzz" })) as { ok: boolean; error: string };
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain("0001-albums, 0002-dark-mode");
    expect(await specContextTool(" ", client())({})).toMatchObject({ ok: false });
  });

  it("turns a host failure into a tool failure", async () => {
    const broken = fakeSpecsClient({ overview: vi.fn(async () => { throw { code: "io_error", message: "not a folder" }; }) });
    expect(await specContextTool("/repo", broken)({})).toEqual({ ok: false, error: "not a folder" });
  });
});

describe("the active change brief", () => {
  it("is empty without an active change, and when it is gone or unreadable", async () => {
    expect(await activeSpecBrief("/repo", client(), null)).toBe("");
    expect(await activeSpecBrief("/repo", client(), "0009-gone")).toBe("");
    expect(await activeSpecBrief("/repo", fakeSpecsClient({ overview: vi.fn(async () => { throw new Error("x"); }) }), "0001-albums")).toBe("");
  });

  it("describes the active change with its open tasks", async () => {
    const text = await activeSpecBrief("/repo", client(), "0001-albums");
    expect(text).toContain("## Active spec change");
    expect(text).toContain("- T1 Model");
  });
});
