/**
 * flowSwitching.ts -- an agent chat's workflow handing over to another at a
 * step boundary.
 *
 * CoreHarness holds the run after a step and asks `agentChatBoundary` whether
 * it should carry on. The flow router rates the finished steps' findings
 * against the workflows this one declared it may hand over to. A decisive pick
 * of a workflow that cannot change files switches; one that can asks the user
 * first; anything else, including a failure, carries on.
 *
 * A switch is a result, not an error: the run ends with `switchTo`, and the
 * Agent tab starts the next run with `context` -- everything finished so far.
 */

import { executionObservability } from "../../../observability/executionStore";
import { jevFlowRecord } from "../../../observability/modelSelectionRecord";
import { routeBoundary } from "../../../services/flowRouter";
import type { CapabilityResult, WorkflowSwitch } from "../../contract";
import type { WorkflowBoundaryContext, WorkflowBoundaryDecision } from "../CoreHarness";
import { MAX_WORKFLOW_CONTEXT_CHARS, type FinishedStep } from "../workflowRun";

const percent = (confidence: number) => `${Math.round(confidence * 100)}%`;

/** What the next workflow starts from: why the hand-over happened and the
 * work finished before it. The latest steps matter most, so the oldest are
 * dropped first when it does not fit. */
export function handOverContext(from: { name: string; step: string }, reason: string, finished: FinishedStep[]): string {
  const header = `Handed over from "${from.name}" after the "${from.step}" step: ${reason}\n\nWork finished before the hand-over:`;
  const blocks = finished.map((step) => `### ${step.name}\n${step.output.trim() || "(no output)"}`);
  const kept: string[] = [];
  let used = header.length;
  for (const block of [...blocks].reverse()) {
    if (used + block.length + 2 > MAX_WORKFLOW_CONTEXT_CHARS && kept.length > 0) break;
    kept.unshift(block);
    used += block.length + 2;
  }
  const omitted = blocks.length - kept.length;
  const body = kept.join("\n\n");
  const clipped = body.length > MAX_WORKFLOW_CONTEXT_CHARS - header.length - 2
    ? `${body.slice(0, Math.max(0, MAX_WORKFLOW_CONTEXT_CHARS - header.length - 40))}\n[… omitted]`
    : body;
  return `${header}${omitted > 0 ? ` (${omitted} earlier step${omitted === 1 ? "" : "s"} omitted)` : ""}\n\n${clipped}`;
}

export async function agentChatBoundary(context: WorkflowBoundaryContext<"agent_chat">): Promise<WorkflowBoundaryDecision> {
  const { input, host, onEvent, signal, step, finished, remaining, request } = context;
  const config = input.flowSwitching;
  if (!config || config.targets.length === 0) return { type: "continue" };

  const route = await routeBoundary(
    {
      request,
      workflowName: config.workflowName,
      step: step.name,
      finished: finished.map(({ name, output }) => ({ name, output })),
      remaining,
      targets: config.targets.map((target) => ({ id: target.id, name: target.name, criterion: target.when, edits: target.edits })),
    },
    {
      ...config.router,
      signal,
      onTrace: (trace) =>
        executionObservability.recordStandalone(
          jevFlowRecord(trace, { tabId: input.tabId, workspaceRoot: input.workspaceRoot, workflow: config.workflowName }),
        ),
    },
  );
  if (route.type === "continue") {
    if (route.reason) onEvent({ kind: "log", message: `Flow check skipped: ${route.reason}` });
    return { type: "continue" };
  }
  const target = config.targets.find((candidate) => candidate.id === route.id);
  if (!target) return { type: "continue" };

  let agreed = false;
  if (route.type === "confirm") {
    if (!host.askQuestion) return { type: "continue" };
    const switchLabel = `Switch to ${target.name}`;
    try {
      const answer = await host.askQuestion(
        {
          requestId: crypto.randomUUID(),
          question: `After "${step.name}", the findings point to "${target.name}" (${percent(route.confidence)} confidence). It can change files. Switch to it?`,
          options: [
            { label: switchLabel, description: target.when },
            { label: "Continue the current workflow", description: remaining.length ? `Carry on with ${remaining.join(" → ")}.` : "Finish as planned." },
          ],
        },
        signal,
      );
      if (answer.trim() !== switchLabel) return { type: "continue" };
      agreed = true;
    } catch {
      return { type: "continue" };
    }
  }

  const reason = `the findings after "${step.name}" fit "${target.name}" better than carrying on${agreed ? " (you agreed)" : ""}`;
  const from = { name: config.workflowName, step: step.name };
  const outcome: WorkflowSwitch = {
    id: target.id,
    name: target.name,
    path: target.path,
    reason,
    confidence: route.confidence,
    context: handOverContext(from, reason, finished),
    from,
  };
  return { type: "switch", outcome };
}

/** The result of a run that handed over. Its response is the announcement the chat shows. */
export function agentChatSwitched(outcome: unknown, ctx: { scratch: Record<string, unknown> }): CapabilityResult<"agent_chat"> {
  const switchTo = outcome as WorkflowSwitch;
  const modifiedFiles = (ctx.scratch.modifiedFiles as Set<string> | undefined) ?? new Set<string>();
  return {
    response: `↪ AUTO · Handing over to ${switchTo.name} (${percent(switchTo.confidence)} confidence): ${switchTo.reason}.`,
    modifiedFiles: Array.from(modifiedFiles),
    subagents: [],
    switchTo,
  };
}
