import { vi } from "vitest";

import type { SpecsClient } from "./client";
import type { ChangeSummary, SpecsOverview } from "./model";

export const emptyOverview: SpecsOverview = { root: "specs", exists: false, project: false, projectWarnings: [], capabilities: [], onboarding: null, changes: [], archive: [], warnings: [] };

export function change(overrides: Partial<ChangeSummary> = {}): ChangeSummary {
  return {
    dir: "0001-albums", number: 1, title: "Photo albums", status: "planned", created: "2026-10-22", branch: "spec/0001-albums",
    tasksDone: 1, tasksTotal: 3, openQuestions: 0, documents: ["change.md", "spec.md", "tasks.md"], taskDocuments: [],
    nextStep: "implement", hint: null, warnings: [], ...overrides,
  };
}

export function fakeSpecsClient(overrides: Partial<SpecsClient> = {}): SpecsClient {
  return {
    overview: vi.fn(async () => emptyOverview),
    document: vi.fn(async () => null),
    tasks: vi.fn(async () => []),
    init: vi.fn(async () => []),
    createChange: vi.fn(async () => ({ dir: "0001-albums", files: [], branch: null })),
    tick: vi.fn(async () => undefined),
    context: vi.fn(async () => "CONTEXT"),
    record: vi.fn(async () => ({ written: [], status: "specified" as const, warnings: [] })),
    queuePlan: vi.fn(async () => ({ full: { tasks: [] }, remaining: { tasks: [] }, totalTasks: 0, remainingTasks: 0 })),
    progress: vi.fn(async () => ({ ticked: [], status: "building" as const, warnings: [] })),
    archive: vi.fn(async () => ({ archivedDir: "specs/archive/2026-10-30-0001-albums", merged: [], unmerged: [] })),
    foreign: vi.fn(async () => []),
    importForeign: vi.fn(async () => ({ project: false, capabilities: [], changes: [], skipped: [] })),
    exportTo: vi.fn(async () => ({ written: [], skipped: [] })),
    onChanged: vi.fn(async () => () => undefined),
    ...overrides,
  };
}
