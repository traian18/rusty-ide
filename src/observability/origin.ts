import type { CapabilityInput, CapabilityName } from "../harness/contract";
import { sanitizeForObservability } from "./redaction";
import type { ExecutionContextSnapshot, ExecutionOrigin } from "./types";

function record(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? input as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function providerName(value: unknown): string | undefined {
  const provider = record(value);
  return text(provider.name) ?? text(provider.id);
}

export function inferExecutionOrigin<K extends CapabilityName>(
  capability: K,
  input: CapabilityInput<K>,
  supplied?: Partial<ExecutionOrigin>,
): ExecutionOrigin {
  const values = record(input);
  const workspaceId = text(values.workspaceRoot);
  const tabId = text(values.tabId);
  const nodeId = text(values.nodeId);
  const edgeId = text(values.edgeId);
  const sessionId = text(values.sessionId);
  const defaults: ExecutionOrigin = (() => {
    if (capability === "agent_chat") return { surface: "agent-tab", workspaceId, tabId, displayLabel: "Agent" };
    if (capability === "inline_chat") return { surface: "inline-chat", workspaceId, tabId: sessionId, displayLabel: "Inline chat" };
    if (capability === "execute_node" || capability === "global_explore" || capability === "generate_task_nodes") {
      return { surface: "canvas-node", workspaceId, nodeId, displayLabel: nodeId ? `Node ${nodeId}` : "Canvas node" };
    }
    if (capability === "reconciliate_edge" || capability === "reconciliate_graph") {
      return { surface: "reconciliation", workspaceId, tabId, canvasId: tabId, nodeId: edgeId, displayLabel: "Reconciliation" };
    }
    if (capability === "generate_skill") return { surface: "skill-generation", workspaceId, displayLabel: "Skill generation" };
    if (capability === "test_build") return { surface: "test-build", workspaceId, tabId, canvasId: tabId, displayLabel: "Test & build" };
    return { surface: "other", workspaceId, displayLabel: capability };
  })();
  return { ...defaults, ...supplied, displayLabel: supplied?.displayLabel || defaults.displayLabel };
}

export function createContextSnapshot<K extends CapabilityName>(
  capability: K,
  input: CapabilityInput<K>,
): ExecutionContextSnapshot {
  const values = record(input);
  const fileReferences = new Set<string>();
  const context = record(values.context);
  const contextFile = text(context.filePath);
  if (contextFile) fileReferences.add(contextFile);
  for (const entry of Array.isArray(values.inputFiles) ? values.inputFiles : []) {
    const path = text(record(entry).path);
    if (path) fileReferences.add(path);
  }
  for (const entry of Array.isArray(values.modifiedFiles) ? values.modifiedFiles : []) {
    if (typeof entry === "string") fileReferences.add(entry);
    else {
      const path = text(record(entry).path);
      if (path) fileReferences.add(path);
    }
  }
  const mcpServers = (Array.isArray(values.mcpServers) ? values.mcpServers : Array.isArray(values.mcpContext) ? values.mcpContext : [])
    .map((entry) => {
      const item = record(entry);
      const server = record(item.server);
      return text(item.displayName) ?? text(item.name) ?? text(server.displayName) ?? text(server.name);
    })
    .filter((value): value is string => Boolean(value));
  const skill = record(values.skill);

  const rawPrompt =
    text(values.message) ??
    text(values.prompt) ??
    text(values.instructions) ??
    text(values.description) ??
    text(values.userMessage) ??
    text(values.additionalInstructions) ??
    text(values.buildCommand);
  const sanitizedPrompt = rawPrompt ? (sanitizeForObservability(rawPrompt).value as string) : undefined;
  const requestPrompt =
    typeof sanitizedPrompt === "string"
      ? sanitizedPrompt.length > 2000
        ? `${sanitizedPrompt.slice(0, 2000)}…`
        : sanitizedPrompt
      : undefined;

  const selectionObj = record(context.selection);
  const selectionText = text(selectionObj.text);
  const startLine = typeof selectionObj.startLine === "number" ? selectionObj.startLine : undefined;
  const endLine = typeof selectionObj.endLine === "number" ? selectionObj.endLine : undefined;
  const lineRange = startLine !== undefined && endLine !== undefined ? `L${startLine}-L${endLine}` : undefined;
  const selection = contextFile
    ? {
        filePath: contextFile,
        lineRange,
        textPreview: selectionText ? (sanitizeForObservability(selectionText).value as string)?.slice(0, 500) : undefined,
      }
    : undefined;

  return {
    capability,
    workspaceRoot: text(values.workspaceRoot),
    model: text(values.model),
    provider: providerName(values.customProvider),
    requestPrompt,
    selection,
    inputKeys: Object.keys(values).filter((key) => !/(message|history|prompt|instructions|content|apiKey|token|secret)/i.test(key)),
    fileReferences: [...fileReferences].slice(0, 100),
    skill: text(skill.name) ?? text(skill.id),
    mcpServers: [...new Set(mcpServers)].slice(0, 100),
  };
}
