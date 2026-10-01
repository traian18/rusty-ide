import type { FlowDecisionTrace } from "../services/flowRouter";
import { AUTO_LEVEL_LABELS, JEV_CONFIDENCE_THRESHOLD, type JevDecisionTrace } from "../services/intelligentModelSelector";
import { sanitizeForObservability } from "./redaction";
import type { ToolExecutionRecord, ToolExecutionStep } from "./types";

export const JEV_SELECTION_TOOL_NAME = "jev_model_selection";

/** AUTO's JEV call happens before the agent run exists, so it is recorded
 * as its own run with a single call rather than inside the run it picked a
 * model for. */
export function jevSelectionRecord(
  trace: JevDecisionTrace,
  origin: { tabId?: string; workspaceRoot?: string; /** The workflow step the choice was made for. */ step?: string },
): ToolExecutionRecord {
  const subject = origin.step ? `the ${origin.step} step` : "this request";
  const request = sanitizeForObservability(trace.request);
  const response = sanitizeForObservability(trace.response);
  const steps: ToolExecutionStep[] = [
    {
      at: trace.startedAt,
      level: "info",
      message: `Asked ${trace.jevModelId} how capable a model ${subject} needs.`,
    },
  ];
  if (trace.httpStatus !== undefined) {
    steps.push({
      at: trace.finishedAt,
      level: trace.httpStatus >= 400 ? "error" : "info",
      message: `OpenRouter responded with HTTP ${trace.httpStatus}.`,
    });
  }
  if (trace.jevLevel && trace.level) {
    const confidence = trace.confidence?.toFixed(2) ?? "unknown";
    steps.push({
      at: trace.finishedAt,
      level: "info",
      message: trace.escalated
        ? `Rated ${AUTO_LEVEL_LABELS[trace.jevLevel]} with confidence ${confidence} (below ${JEV_CONFIDENCE_THRESHOLD.toFixed(2)}); stepped up to ${AUTO_LEVEL_LABELS[trace.level]}.`
        : `Rated ${AUTO_LEVEL_LABELS[trace.level]} with confidence ${confidence}.`,
      details: { probabilities: trace.probabilities, cost: trace.cost },
    });
    steps.push({
      at: trace.finishedAt,
      level: "info",
      message: `${AUTO_LEVEL_LABELS[trace.level]} runs on ${trace.selectedModel}.`,
    });
  }
  if (trace.error) {
    steps.push({ at: trace.finishedAt, level: "error", message: trace.error });
  }

  const durationMs = Date.parse(trace.finishedAt) - Date.parse(trace.startedAt);
  const redacted = request.state === "redacted" || response.state === "redacted";
  const truncated = request.state === "truncated" || response.state === "truncated";
  return {
    id: `${trace.id}:decision`,
    callId: trace.id,
    ideRunId: trace.id,
    toolName: JEV_SELECTION_TOOL_NAME,
    status: trace.outcome === "selected" ? "succeeded" : "failed",
    requestedAt: trace.startedAt,
    startedAt: trace.startedAt,
    finishedAt: trace.finishedAt,
    durationMs: Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : undefined,
    arguments: request.value,
    resultPreview: typeof response.value === "string"
      ? response.value
      : JSON.stringify(response.value ?? null, null, 2),
    origin: {
      surface: "agent-tab",
      tabId: origin.tabId,
      workspaceId: origin.workspaceRoot,
      displayLabel: origin.step ? `AUTO model selection · ${origin.step}` : "AUTO model selection",
    },
    context: {
      capability: "agent_chat",
      workspaceRoot: origin.workspaceRoot,
      model: trace.jevModelId,
      provider: "openrouter",
      requestPrompt: trace.query,
      inputKeys: [],
      fileReferences: [],
      mcpServers: [],
    },
    execution: {
      executor: { kind: "model", purpose: "AUTO model selection", model: trace.jevModelId, provider: "openrouter", providerId: "openrouter" },
      steps,
    },
    requestedBy: { model: trace.jevModelId, provider: "openrouter" },
    payloadState: redacted ? "redacted" : truncated ? "truncated" : "full",
  };
}

export const JEV_FLOW_TOOL_NAME = "jev_flow_selection";

/** A flow routing call, recorded like AUTO's model selection: its own run with
 * one call. At a step boundary `workflow` names the run it was made for. */
export function jevFlowRecord(
  trace: FlowDecisionTrace,
  origin: { tabId?: string; workspaceRoot?: string; workflow?: string },
): ToolExecutionRecord {
  const request = sanitizeForObservability(trace.request);
  const response = sanitizeForObservability(trace.response);
  const boundary = trace.kind === "boundary";
  const purpose = boundary ? "AUTO flow switching" : "AUTO flow selection";
  const steps: ToolExecutionStep[] = [
    {
      at: trace.startedAt,
      level: "info",
      message: boundary
        ? `Asked ${trace.jevModelId} whether ${origin.workflow ? `"${origin.workflow}"` : "the workflow"} should carry on or hand over.`
        : `Asked ${trace.jevModelId} which workflow fits the message.`,
    },
  ];
  if (trace.httpStatus !== undefined) {
    steps.push({
      at: trace.finishedAt,
      level: trace.httpStatus >= 400 ? "error" : "info",
      message: `OpenRouter responded with HTTP ${trace.httpStatus}.`,
    });
  }
  if (trace.outcome === "decided" && trace.choice !== undefined) {
    steps.push({
      at: trace.finishedAt,
      level: "info",
      message: `Chose ${trace.choice} with confidence ${trace.confidence?.toFixed(2) ?? "unknown"}.`,
      details: { ranked: trace.ranked, cost: trace.cost },
    });
  }
  if (trace.error) steps.push({ at: trace.finishedAt, level: "error", message: trace.error });

  const durationMs = Date.parse(trace.finishedAt) - Date.parse(trace.startedAt);
  const redacted = request.state === "redacted" || response.state === "redacted";
  const truncated = request.state === "truncated" || response.state === "truncated";
  return {
    id: `${trace.id}:flow`,
    callId: trace.id,
    ideRunId: trace.id,
    toolName: JEV_FLOW_TOOL_NAME,
    status: trace.outcome === "decided" ? "succeeded" : "failed",
    requestedAt: trace.startedAt,
    startedAt: trace.startedAt,
    finishedAt: trace.finishedAt,
    durationMs: Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : undefined,
    arguments: request.value,
    resultPreview: typeof response.value === "string" ? response.value : JSON.stringify(response.value ?? null, null, 2),
    origin: {
      surface: "agent-tab",
      tabId: origin.tabId,
      workspaceId: origin.workspaceRoot,
      displayLabel: origin.workflow ? `${purpose} · ${origin.workflow}` : purpose,
    },
    context: {
      capability: "agent_chat",
      workspaceRoot: origin.workspaceRoot,
      model: trace.jevModelId,
      provider: "openrouter",
      requestPrompt: trace.query,
      inputKeys: [],
      fileReferences: [],
      mcpServers: [],
    },
    execution: {
      executor: { kind: "model", purpose, model: trace.jevModelId, provider: "openrouter", providerId: "openrouter" },
      steps,
    },
    requestedBy: { model: trace.jevModelId, provider: "openrouter" },
    payloadState: redacted ? "redacted" : truncated ? "truncated" : "full",
  };
}
