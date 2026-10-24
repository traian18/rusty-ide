import { describe, expect, it } from "vitest";

import { exportSummary, foreignSummary, groupChanges, importSummary, localDate, progressText, taskDocument, taskReferences } from "./pure";
import { change } from "./specs.testing";

describe("specs helpers", () => {
  it("groups changes by status, working ones first, leaving out empty groups", () => {
    const groups = groupChanges([change({ dir: "a", status: "done" }), change({ dir: "b", status: "draft" }), change({ dir: "c", status: "building" }), change({ dir: "d", status: "draft" })]);
    expect(groups.map((group) => [group.status, group.changes.map((c) => c.dir)])).toEqual([["building", ["c"]], ["draft", ["b", "d"]], ["done", ["a"]]]);
  });

  it("shows progress as done over total, or says there are no tasks", () => {
    expect(progressText({ tasksDone: 3, tasksTotal: 8 })).toBe("3/8");
    expect(progressText({ tasksDone: 0, tasksTotal: 0 })).toBe("no tasks");
  });

  it("finds a task's own document by its id", () => {
    const files = ["T1-album-model.md", "T12-other.md", "notes.md"];
    expect(taskDocument({ id: "T1" }, files)).toBe("T1-album-model.md");
    expect(taskDocument({ id: "T12" }, files)).toBe("T12-other.md");
    expect(taskDocument({ id: "T2" }, files)).toBeUndefined();
  });

  it("writes a task's references on one line", () => {
    expect(taskReferences({ requirements: ["R1"], criteria: ["C1", "C2"], after: ["T1"] })).toBe("R1 (C1, C2) · after T1");
    expect(taskReferences({ requirements: [], criteria: [], after: [] })).toBe("");
  });

  it("formats the date from the local clock", () => {
    expect(localDate(new Date(2026, 9, 3))).toBe("2026-10-03");
  });

  it("describes what an export wrote and left alone", () => {
    expect(exportSummary("spec_kit", { written: ["a", "b"], skipped: ["1 capability spec have no Spec Kit equivalent and were not exported"] })).toBe("Wrote 2 files in the Spec Kit layout. Left alone: 1 capability spec have no Spec Kit equivalent and were not exported.");
    expect(exportSummary("open_spec", { written: [], skipped: [] })).toBe("Nothing new to write for OpenSpec.");
  });

  it("describes a foreign folder and what importing it did", () => {
    expect(foreignSummary({ source: "open_spec", path: "openspec", capabilities: 2, changes: 1, archived: 3 })).toBe("OpenSpec found in openspec: 2 capabilities, 1 change (3 finished ones are not imported).");
    expect(foreignSummary({ source: "spec_kit", path: ".specify", capabilities: 0, changes: 0, archived: 0 })).toBe("Spec Kit found in .specify: a project file.");
    expect(importSummary({ project: true, capabilities: ["a"], changes: ["0001-x", "0002-y"], skipped: ["change z was imported before"] })).toBe("Imported the project file, 1 capability, 2 changes. Left alone: change z was imported before.");
    expect(importSummary({ project: false, capabilities: [], changes: [], skipped: [] })).toBe("Nothing new to import.");
  });
});
