import type { RunTrajectory, TrajectoryEntry } from "../../observability/trajectoryStore";
import type { ToolExecutionRecord } from "../../observability/types";

export interface ObservabilityPerformanceFixture {
  trajectories: RunTrajectory[];
  records: ToolExecutionRecord[];
  streamEntries: TrajectoryEntry[];
}

/** Deterministic heavy-history data for React Profiler and browser Performance runs. */
export function createObservabilityPerformanceFixture(runCount = 100): ObservabilityPerformanceFixture {
  const base = Date.UTC(2025, 0, 1, 12);
  const trajectories: RunTrajectory[] = [];
  const records: ToolExecutionRecord[] = [];
  for (let runIndex = 0; runIndex < runCount; runIndex++) {
    const runId = `perf-run-${runIndex}`;
    const startedAt = new Date(base - runIndex * 60_000).toISOString();
    const entries: TrajectoryEntry[] = Array.from({ length: runIndex === 0 ? 300 : 12 }, (_, entryIndex) => ({
      id: `${runId}-entry-${entryIndex}`,
      timestamp: new Date(Date.parse(startedAt) + entryIndex * 100).toISOString(),
      source: entryIndex % 2 ? "AssistantTextDelta" : "ReasoningDelta",
      payload: entryIndex % 2
        ? { AssistantTextDelta: { message_id: `${runId}-answer`, delta: `assistant fixture ${entryIndex} ${"text ".repeat(40)}` } }
        : { ReasoningDelta: { message_id: `${runId}-thought`, delta: `reasoning fixture ${entryIndex} ${"thought ".repeat(40)}` } },
      payloadState: "full",
    }));
    trajectories.push({
      id: runId,
      startedAt,
      finishedAt: runIndex === 0 ? undefined : new Date(Date.parse(startedAt) + 30_000).toISOString(),
      origin: { surface: "agent-tab", displayLabel: "Performance fixture" },
      context: { capability: "agent_chat", model: "fixture-model", requestPrompt: `Large fixture prompt ${runIndex} ${"context ".repeat(80)}`, inputKeys: [], fileReferences: [], mcpServers: [] },
      status: runIndex === 0 ? "running" : "completed",
      entries,
      omittedEntries: 0,
    });
    for (let recordIndex = 0; recordIndex < 5; recordIndex++) {
      const requestedAt = new Date(Date.parse(startedAt) + recordIndex * 1_000).toISOString();
      records.push({
        id: `${runId}-tool-${recordIndex}`,
        callId: `${runId}-call-${recordIndex}`,
        ideRunId: runId,
        toolName: "fixture_tool",
        status: runIndex === 0 && recordIndex === 4 ? "running" : "succeeded",
        requestedAt,
        startedAt: requestedAt,
        durationMs: 750,
        arguments: { path: `/fixture/${runIndex}/${recordIndex}`, payload: "argument ".repeat(200) },
        resultPreview: `fixture result ${"result ".repeat(100)}`,
        origin: { surface: "agent-tab", displayLabel: "Performance fixture" },
        context: { capability: "agent_chat", model: "fixture-model", inputKeys: [], fileReferences: [], mcpServers: [] },
        payloadState: "full",
      });
    }
  }
  const streamEntries = Array.from({ length: 100 }, (_, index) => ({
    id: `stream-${index}`,
    timestamp: new Date(base + index * 80).toISOString(),
    source: index % 2 ? "AssistantTextDelta" : "ReasoningDelta",
    payload: index % 2
      ? { AssistantTextDelta: { message_id: "stream-answer", delta: `stream ${index} ` } }
      : { ReasoningDelta: { message_id: "stream-thought", delta: `thought ${index} ` } },
    payloadState: "full" as const,
  }));
  return { trajectories, records, streamEntries };
}
