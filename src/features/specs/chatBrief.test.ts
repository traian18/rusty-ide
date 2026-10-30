import { describe, expect, it } from "vitest";

import { formatActiveBrief, formatChange, formatSpecList } from "./chatBrief";
import { change, emptyOverview } from "./specs.testing";
import type { SpecTask } from "./model";

const task = (id: string, title: string, done: boolean, extra: Partial<SpecTask> = {}): SpecTask => ({ id, title, done, line: 1, requirements: ["R1"], criteria: ["C1"], after: [], instructions: "", ...extra });

describe("spec chat text", () => {
  it("says there are no specs, or lists the project, capabilities and changes", () => {
    expect(formatSpecList(emptyOverview)).toContain("no specs in this repository yet");
    const text = formatSpecList({
      ...emptyOverview, exists: true, project: true,
      capabilities: [{ name: "albums", title: "Albums", purpose: "grouping", requirements: 2, path: "specs/capabilities/albums/spec.md", warnings: [] }],
      changes: [change({ openQuestions: 2 })],
    });
    expect(text).toContain("- project: specs/project.md");
    expect(text).toContain("capability albums: Albums (grouping), 2 requirements");
    expect(text).toContain("change 0001-albums: 0001 Photo albums, planned, tasks 1/3, 2 open questions, next: implement");
  });

  it("returns a change with its open tasks and the documents asked for", () => {
    const text = formatChange("specs", change({ hint: "Every task is ticked." }), [task("T1", "Model", true), task("T2", "Sidebar", false, { after: ["T1"] })], [{ name: "spec", text: "# Spec\n" }, { name: "design", text: null }]);
    expect(text).toContain("Change 0001 Photo albums (specs/changes/0001-albums/): planned, tasks 1/3, branch spec/0001-albums.");
    expect(text).toContain("Open tasks:\n- T2 Sidebar (R1 (C1) · after T1)");
    expect(text).not.toContain("- T1 Model");
    expect(text).toContain("## spec (specs/changes/0001-albums/spec.md)\n\n# Spec");
    expect(text).toContain("This document does not exist yet.");
  });

  it("cuts a very long document and says so", () => {
    const text = formatChange("specs", change(), [], [{ name: "spec", text: "x".repeat(30_000) }]);
    expect(text).toContain("the rest is omitted");
    expect(text.length).toBeLessThan(21_000);
  });

  it("writes a short brief with the first open tasks and a pointer to the tool", () => {
    const tasks = Array.from({ length: 10 }, (_, i) => task(`T${i + 1}`, `Task ${i + 1}`, false));
    const text = formatActiveBrief("specs", change({ openQuestions: 1 }), tasks);
    expect(text).toContain("## Active spec change");
    expect(text).toContain("- T8 Task 8 (R1 (C1))\n- … and 2 more");
    expect(text).toContain("1 open question.");
    expect(text).toContain('spec_context with {"change": "0001-albums"}');
  });
});
