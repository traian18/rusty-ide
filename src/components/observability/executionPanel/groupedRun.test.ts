import { describe, expect, it } from "vitest";

import type { RunTrajectory, TrajectoryEntry } from "../../../observability/trajectoryStore";
import type { ToolExecutionRecord } from "../../../observability/types";
import { buildGroupedRun } from "./groupedRun";
import { findSelected, groupRuns, runMatches } from "./runList";

function record(id: string, overrides: Partial<ToolExecutionRecord> = {}): ToolExecutionRecord {
  return {
    id,
    callId: id,
    ideRunId: "run-1",
    sessionId: "sess-1",
    toolName: "workspace.read",
    status: "succeeded",
    requestedAt: "2026-10-22T10:00:00.000Z",
    startedAt: "2026-10-22T10:00:01.000Z",
    origin: { surface: "agent", displayLabel: "Agent" },
    context: { capability: "agent_chat", requestPrompt: "Fix the build" },
    payloadState: "full",
    arguments: { path: "README.md" },
    ...overrides,
  } as ToolExecutionRecord;
}

function trajectory(overrides: Partial<RunTrajectory> = {}): RunTrajectory {
  return {
    id: "run-1",
    startedAt: "2026-10-22T10:00:00.000Z",
    origin: { surface: "agent", displayLabel: "Agent" },
    context: { capability: "agent_chat" },
    status: "completed",
    entries: [],
    omittedEntries: 0,
    ...overrides,
  } as RunTrajectory;
}

function textEntry(id: string, source: string, delta: string, timestamp: string): TrajectoryEntry {
  return { id, source, timestamp, payload: { [source]: { message_id: `m-${id}`, delta } }, payloadState: "full" };
}

describe("buildGroupedRun", () => {
  it("closes calls a finished run left active with the run's outcome", () => {
    const run = buildGroupedRun("run-1", trajectory({ status: "cancelled", finishedAt: "2026-10-22T10:00:05.000Z" }), [
      record("a", { status: "running" }),
      record("b", { status: "succeeded", resultPreview: "ok" }),
    ]);

    expect(run.records.map((r) => r.status)).toEqual(["cancelled", "succeeded"]);
    expect(run.records[0]).toMatchObject({
      finishedAt: "2026-10-22T10:00:05.000Z",
      durationMs: 4000,
      resultPreview: "Process ended before a terminal tool event was recorded.",
    });
    expect(run.status).toBe("cancelled");
  });

  it("fails calls left waiting for permission when the run did not end by cancellation", () => {
    const run = buildGroupedRun("run-1", trajectory({ status: "failed" }), [record("a", { status: "waiting-permission" })]);
    expect(run.records[0].status).toBe("failed");
    expect(run.status).toBe("failed");
  });

  it("ranks running over failed over cancelled over succeeded", () => {
    const status = (statuses: ToolExecutionRecord["status"][]) =>
      buildGroupedRun("run-1", undefined, statuses.map((s, i) => record(`r${i}`, { status: s }))).status;
    expect(status(["failed", "running"])).toBe("running");
    expect(status(["cancelled", "failed"])).toBe("failed");
    expect(status(["cancelled", "cancelled"])).toBe("cancelled");
    expect(status(["cancelled", "succeeded"])).toBe("succeeded");
  });

  it("puts tool calls and both kinds of streamed text on one timeline in time order, skipping blank text", () => {
    const run = buildGroupedRun("run-1", trajectory({
      entries: [
        textEntry("e1", "ReasoningDelta", "thinking", "2026-10-22T10:00:00.500Z"),
        textEntry("e2", "AssistantTextDelta", "Done.", "2026-10-22T10:00:02.000Z"),
        textEntry("e3", "AssistantTextDelta", "   ", "2026-10-22T10:00:03.000Z"),
      ],
    }), [record("a")]);

    expect(run.timelineItems.map((item) => item.id)).toEqual(["reasoning-e1", "a", "text-e2"]);
    expect(run.timelineItems[0]).toMatchObject({ kind: "reasoning", messageId: "m-e1", text: "thinking" });
  });
});

describe("runList", () => {
  const filters = { status: "all" as const, surface: "all", needle: "" };

  it("filters by run or call status, by source, and by text anywhere in the run", () => {
    const run = buildGroupedRun("run-1", trajectory({
      entries: [textEntry("e1", "ReasoningDelta", "Consider the Cache layer", "2026-10-22T10:00:00.500Z")],
    }), [record("a", { status: "failed", arguments: { path: "src/main.rs" } }), record("b")]);

    expect(runMatches(run, { ...filters, status: "succeeded" })).toBe(true);
    expect(runMatches(run, { ...filters, status: "cancelled" })).toBe(false);
    expect(runMatches(run, { ...filters, surface: "canvas" })).toBe(false);
    expect(runMatches(run, { ...filters, needle: "cache layer" })).toBe(true);
    expect(runMatches(run, { ...filters, needle: "main.rs" })).toBe(true);
    expect(runMatches(run, { ...filters, needle: "fix the build" })).toBe(true);
    expect(runMatches(run, { ...filters, needle: "nowhere" })).toBe(false);
  });

  it("reuses a run whose trajectory and records are unchanged, newest run first", () => {
    const older = trajectory({ id: "run-old", startedAt: "2026-10-21T10:00:00.000Z" });
    const records = [record("a"), record("b", { ideRunId: "run-new", startedAt: "2026-10-22T11:00:00.000Z" })];
    const first = groupRuns(records, [older], new Map());
    const second = groupRuns(records, [older], first.cache);

    expect(first.runs.map((run) => run.runId)).toEqual(["run-new", "run-1", "run-old"]);
    expect(second.runs).toEqual(first.runs);
    second.runs.forEach((run, index) => expect(run).toBe(first.runs[index]));
    expect(findSelected(first.runs, "b")?.run.runId).toBe("run-new");
  });
});
