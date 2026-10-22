import type { ToolExecutionRecord, ToolExecutor } from "../../observability/types";
import { ARGUMENT_NAMES, CALL_READERS, firstTrimmed, type KeyParam, type SummaryDraft, type ToolArguments } from "./callArguments";

export { truncateCommand } from "./callArguments";

export interface CallSummary {
  actionLabel: string;
  summary?: string;
  target?: string;
  description?: string;
  instruction?: string;
  keyParams: { label: string; value: string }[];
}

/** What the model said about its own call, when it said anything. */
function selfDescription(args: ToolArguments | null) {
  if (!args) return {};
  return {
    action: firstTrimmed(args, ARGUMENT_NAMES.action),
    summary: firstTrimmed(args, ARGUMENT_NAMES.summary),
    description: firstTrimmed(args, ARGUMENT_NAMES.description),
    instruction: firstTrimmed(args, ARGUMENT_NAMES.instruction),
  };
}

function appendOnce(keyParams: KeyParam[], label: string, value: string | undefined): void {
  if (value && !keyParams.some((param) => param.label === label)) keyParams.push({ label, value });
}

export function extractCallSummary(record: ToolExecutionRecord): CallSummary {
  const args = record.arguments && typeof record.arguments === "object" ? record.arguments as ToolArguments : null;
  const { action, summary, description, instruction } = selfDescription(args);
  const draft: SummaryDraft = { toolName: record.toolName, actionLabel: action ?? record.toolName, keyParams: [] };
  if (args) CALL_READERS.forEach((read) => read(args, draft));
  appendOnce(draft.keyParams, "Summary", summary);
  appendOnce(draft.keyParams, "Description", description);
  appendOnce(draft.keyParams, "Instruction", instruction);
  return { actionLabel: draft.actionLabel, summary, target: draft.target, description, instruction, keyParams: draft.keyParams };
}

export function formatCompactCallLabel(record: ToolExecutionRecord): string {
  const summary = extractCallSummary(record);
  if (summary.target) {
    const shortTarget = summary.target.length > 25
      ? `${summary.target.slice(0, 25)}...`
      : summary.target;
    return `${record.toolName}: ${shortTarget}`;
  }
  return record.toolName;
}

/** "claude-haiku (Anthropic)" for a model, "tavily" for a service. */
export function formatToolExecutor(executor: ToolExecutor): string {
  if (executor.model) return executor.provider ? `${executor.model} (${executor.provider})` : executor.model;
  return executor.provider ?? executor.purpose;
}

export interface CallModels {
  /** The model that issued the call. */
  requestedBy: string;
  /** The model or service that did the work, or why there is none. */
  executedBy: string;
  /** True when something other than the requesting model did the work. */
  delegated: boolean;
}

const ACTIVE = new Set(["queued", "waiting-permission", "running"]);

/** Which models a tool call involved, for every tool: a delegated model or
 * service when the tool reported one, otherwise an explicit "no model". */
export function describeCallModels(record: ToolExecutionRecord): CallModels {
  const requester = record.requestedBy?.model ?? record.context.model ?? "unknown model";
  const requestedBy = record.requestedBy?.subagent ? `${requester} (subagent)` : requester;
  const executor = record.execution?.executor;
  if (executor) return { requestedBy, executedBy: `${formatToolExecutor(executor)} · ${executor.purpose}`, delegated: true };
  const executedBy = ACTIVE.has(record.status) ? "Not reported yet" : "No model (tool runs as code)";
  return { requestedBy, executedBy, delegated: false };
}
