import { describe, expect, it, vi } from "vitest";

import { fakeSpecsClient } from "./specs.testing";
import { capabilityRequest, implementProgress, implementTicker, recordImplementRun, recordSpecRun, specDocuments, specRequest, startRequest } from "./run";

const definition = {
  metadata: { spec: { step: "plan", outputs: { architect: "design.md", tasks: "tasks.md" } } },
  nodes: [{ id: "input", type: "input" }, { id: "architect", type: "agent", name: "Design" }, { id: "tasks", type: "agent", name: "Tasks" }, { id: "output", type: "output" }],
  edges: [{ source: "input", target: "architect" }, { source: "architect", target: "tasks" }, { source: "tasks", target: "output" }],
};
const state = (outputs: Record<string, unknown>) => ({ steps: Object.fromEntries(Object.entries(outputs).map(([id, output]) => [id, { status: "succeeded", output }])) });
const run = { root: "/repo", change: "0001-albums", step: "plan" as const };

describe("spec runs", () => {
  it("names the file the step writes and leaves a place for notes", () => {
    const text = specRequest("specify", { number: 7, title: "Photo albums", dir: "0007-photo-albums" }, "specs");
    expect(text).toContain("change 0007 Photo albums, into specs/changes/0007-photo-albums/spec.md");
    expect(text.endsWith("Notes: ")).toBe(true);
    expect(specRequest("plan", { number: null, title: "X", dir: "x" }, "specs")).toContain("design.md and tasks.md");
  });

  it("takes each mapped step's reply as that document", () => {
    const docs = specDocuments(definition, state({ architect: "# Design\n", tasks: "# Tasks\n- [ ] **T1** a. R1\n" }));
    expect(docs).toEqual([{ name: "design.md", text: "# Design\n" }, { name: "tasks.md", text: "# Tasks\n- [ ] **T1** a. R1\n" }]);
  });

  it("skips steps that did not finish or said nothing, and workflows with no mapping", () => {
    expect(specDocuments(definition, state({ architect: "  " }))).toEqual([]);
    expect(specDocuments({ ...definition, metadata: {} }, state({ architect: "# D\n" }))).toEqual([]);
  });

  it("records the documents and reports what was saved", async () => {
    const client = fakeSpecsClient({ record: vi.fn(async () => ({ written: ["specs/changes/0001-albums/design.md", "specs/changes/0001-albums/tasks.md"], status: "planned" as const, warnings: [{ file: "f", line: 1, severity: "warning" as const, message: "m" }, { file: "f", line: 2, severity: "note" as const, message: "n" }] })) });
    const note = await recordSpecRun(client, run, definition, state({ architect: "# D\n", tasks: "# T\n" }), "2026-10-23");
    expect(client.record).toHaveBeenCalledWith("/repo", "0001-albums", "plan", [{ name: "design.md", text: "# D\n" }, { name: "tasks.md", text: "# T\n" }], "2026-10-23");
    expect(note).toContain("Saved design.md, tasks.md in specs/changes/0001-albums. Status: planned. 1 problem to look at on the Specs page.");
  });

  it("says so when nothing came back or saving failed", async () => {
    const client = fakeSpecsClient({ record: vi.fn(async () => { throw { code: "io_error", message: "disk full" }; }) });
    expect(await recordSpecRun(client, run, definition, state({}), "d")).toContain("produced no document");
    expect(await recordSpecRun(client, run, definition, state({ architect: "# D\n" }), "d")).toContain("could not be saved to the change: disk full");
  });

  it("asks to build what is not ticked and verify the spec", () => {
    const text = specRequest("implement", { number: 7, title: "Photo albums", dir: "0007-photo-albums" }, "specs");
    expect(text).toContain("Implement change 0007 Photo albums from specs/changes/0007-photo-albums");
    expect(text).toContain("not ticked yet");
  });
});

const accepted = [
  { task_id: "T1", build: { status: "complete", summary: "Changed a.rs" }, review: { status: "complete", criteria: [{ id: "C1", evidence: "a.rs:3" }] } },
  { task_id: "T2", skipped: true, reason: "skipped" },
];
const report = { summary: "Fine.", criteria: [{ id: "C1", status: "pass", evidence: "a.rs:3", how_to_test: "" }, { id: "C2", status: "manual", evidence: "needs a device", how_to_test: "Open it." }] };

describe("implement runs", () => {
  it("takes the accepted tasks from the queue's checkpoint, also when the run did not finish, and skips skipped ones", () => {
    const stopped = { steps: { build: { status: "running", attempts: [{ checkpoint: { completed: accepted } }] } } };
    const progress = implementProgress(stopped, false);
    expect(progress.tasks.map((task) => task.id)).toEqual(["T1"]);
    expect(progress.tasks[0].built).toContain("Changed a.rs");
    expect(progress.tasks[0].review).toContain("a.rs:3");
    expect(progress).toMatchObject({ verification: null, passed: false });
  });

  it("falls back to the build output and reads Verify's report only when that step succeeded", () => {
    const finished = { steps: { build: { status: "succeeded", output: { tasks: accepted } }, verify: { status: "succeeded", output: report } } };
    const progress = implementProgress(finished, true);
    expect(progress.tasks.map((task) => task.id)).toEqual(["T1"]);
    expect(progress.verification?.criteria.map((c) => c.status)).toEqual(["pass", "manual"]);
    expect(implementProgress({ steps: { verify: { status: "failed", output: report } } }, false).verification).toBeNull();
  });

  it("records progress and says what was ticked", async () => {
    const client = fakeSpecsClient({ progress: vi.fn(async () => ({ ticked: ["T1"], status: "building" as const, warnings: [] })) });
    const state = { steps: { build: { status: "running", checkpoint: { completed: accepted } } } };
    const note = await recordImplementRun(client, { ...run, step: "implement" }, state, false, "2026-10-24");
    expect(client.progress).toHaveBeenCalledWith("/repo", "0001-albums", expect.objectContaining({ passed: false, tasks: [expect.objectContaining({ id: "T1" })] }), "2026-10-24");
    expect(note).toContain("Ticked T1. Status: building.");
  });

  it("ticks each task once, as soon as the queue accepts it", async () => {
    const client = fakeSpecsClient({ progress: vi.fn(async () => ({ ticked: [], status: "building" as const, warnings: [] })) });
    const ticked = vi.fn();
    const tick = implementTicker(client, { ...run, step: "implement" }, () => "2026-10-25", ticked);
    const at = (completed: unknown[]) => ({ steps: { build: { status: "running", checkpoint: { completed } } } });
    tick(at([]));
    tick(at(accepted));
    tick(at(accepted));
    await vi.waitFor(() => expect(ticked).toHaveBeenCalledTimes(1));
    expect(client.progress).toHaveBeenCalledTimes(1);
    expect(client.progress).toHaveBeenCalledWith("/repo", "0001-albums", expect.objectContaining({ passed: false, tasks: [expect.objectContaining({ id: "T1" })] }), "2026-10-25");
  });

  it("stays quiet when a failed run finished nothing, and reports a save that fails", async () => {
    const client = fakeSpecsClient();
    expect(await recordImplementRun(client, { ...run, step: "implement" }, { steps: {} }, false, "d")).toBe("");
    expect(client.progress).not.toHaveBeenCalled();
    const broken = fakeSpecsClient({ progress: vi.fn(async () => { throw { code: "io_error", message: "disk full" }; }) });
    expect(await recordImplementRun(broken, { ...run, step: "implement" }, { steps: {} }, true, "d")).toContain("could not be saved to the change: disk full");
  });
});

describe("start runs", () => {
  const start = {
    metadata: { spec: { step: "start", outputs: { project: "project.md", survey: "onboarding.md" } } },
    nodes: [{ id: "input", type: "input" }, { id: "analyze", type: "agent", name: "Analyze" }, { id: "project", type: "agent", name: "P" }, { id: "survey", type: "agent", name: "S" }, { id: "output", type: "output" }],
    edges: [{ source: "input", target: "analyze" }, { source: "analyze", target: "project" }, { source: "project", target: "survey" }, { source: "survey", target: "output" }],
  };

  it("asks for the project file and the capability list, and leaves a place to describe a new project", () => {
    const text = startRequest("specs");
    expect(text).toContain("specs/project.md");
    expect(text).toContain("specs/onboarding.md");
    expect(text.endsWith("describe what it is for): ")).toBe(true);
  });

  it("names the capability and the file its spec goes to", () => {
    const text = capabilityRequest({ name: "albums", title: "Albums" }, "specs");
    expect(text).toContain("capability Albums, into specs/capabilities/albums/spec.md");
    expect(text.endsWith("Notes: ")).toBe(true);
  });

  it("takes the project and the survey replies and ignores the analysis", () => {
    const docs = specDocuments(start, state({ analyze: "notes", project: "# P\n", survey: "# O\n\n## a\nPurpose: x\n" }));
    expect(docs.map((d) => d.name)).toEqual(["project.md", "onboarding.md"]);
  });

  it("reports how many files were saved, with no status", async () => {
    const client = fakeSpecsClient({ record: vi.fn(async () => ({ written: ["specs/project.md", "specs/capabilities/a/spec.md"], status: "draft" as const, warnings: [] })) });
    const note = await recordSpecRun(client, { root: "/repo", change: "", step: "start" }, start, state({ project: "# P\n" }), "2026-10-24");
    expect(client.record).toHaveBeenCalledWith("/repo", "", "start", [{ name: "project.md", text: "# P\n" }], "2026-10-24");
    expect(note).toContain("Saved 2 files: specs/project.md, specs/capabilities/a/spec.md.");
    expect(note).not.toContain("Status");
  });
});
