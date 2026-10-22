// Translating between rusty-core's agent messages and pi-ai's message shapes.

import type { AgentMessage, ModelUsage } from "./ExecutionProtocol";

export function textFromPiMessage(message: any): string {
  return Array.isArray(message?.content)
    ? message.content
      .filter((part: any) => part?.type === "text" && typeof part.text === "string")
      .map((part: any) => part.text)
      .join("")
    : "";
}

function toolOutputText(outputPreview: string): string {
  try {
    const parsed = JSON.parse(outputPreview);
    return typeof parsed === "string" ? parsed : outputPreview;
  } catch {
    return outputPreview;
  }
}

export function toExecutionUsage(sample: any): ModelUsage {
  return {
    input_tokens: sample?.input ?? null,
    output_tokens: sample?.output ?? null,
    cache_read_tokens: sample?.cacheRead ?? null,
    cache_write_tokens: sample?.cacheWrite ?? null,
    reasoning_tokens: sample?.reasoning ?? null,
    total_tokens: sample?.totalTokens ?? null,
  };
}

/** A Tool message's results, one pi-ai `toolResult` message each. */
function toolResultMessages(message: any, toolNamesByCallId: Map<string, string>, timestamp: number): any[] {
  return message.content
    .filter((block: any) => "ToolResult" in block)
    .map((block: any) => {
      const { call_id, result } = block.ToolResult;
      return {
        role: "toolResult",
        toolCallId: call_id,
        toolName: toolNamesByCallId.get(call_id) || "",
        content: [{ type: "text", text: toolOutputText(result.output_preview) }],
        details: {},
        isError: result.has_error,
        timestamp,
      };
    });
}

/** One content block as a pi-ai content part; undefined for a block pi-ai has no part for. */
function contentPart(block: any, toolNamesByCallId: Map<string, string>): any | undefined {
  if ("Text" in block) return { type: "text", text: block.Text.text };
  if ("ToolUse" in block) {
    const { id, name, arguments: args } = block.ToolUse.call;
    toolNamesByCallId.set(id, name);
    return { type: "toolCall", id, name, arguments: args ?? {} };
  }
  if ("ToolResult" in block) return { type: "text", text: toolOutputText(block.ToolResult.result.output_preview) };
  if ("Image" in block) return { type: "text", text: "[image omitted]" };
  return undefined;
}

const hasToolCall = (content: any[]) => content.some((part) => part.type === "toolCall");

function assistantMessage(content: any[], model: any, timestamp: number) {
  return {
    role: "assistant",
    content,
    api: model?.api,
    provider: model?.provider,
    model: model?.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: hasToolCall(content) ? "toolUse" : "stop",
    timestamp,
  };
}

/** rusty-core sends an Assistant message per block; pi-ai wants one assistant turn. */
function appendAssistantTurn(out: any[], content: any[], model: any, timestamp: number): void {
  const previous = out[out.length - 1];
  if (previous?.role !== "assistant") {
    out.push(assistantMessage(content, model, timestamp));
    return;
  }
  previous.content.push(...content);
  if (hasToolCall(content)) previous.stopReason = "toolUse";
  previous.timestamp = Math.max(previous.timestamp, timestamp);
}

/** Verbatim port of llmRuntime.ts's own `piMessagesFromAgentMessages` --
 * see its doc comment there for why the merge-consecutive-Assistant-
 * messages and full-AssistantMessage-shape behavior exist (two real bugs
 * found live-testing execute_node against Phase 1). */
export function piMessagesFromAgentMessages(messages: AgentMessage[], model: any): any[] {
  const toolNamesByCallId = new Map<string, string>();
  const out: any[] = [];
  for (const message of messages as any[]) {
    const timestamp = Date.parse(message.created_at) || Date.now();
    if (message.role === "Tool") {
      out.push(...toolResultMessages(message, toolNamesByCallId, timestamp));
      continue;
    }
    const content = message.content
      .map((block: any) => contentPart(block, toolNamesByCallId))
      .filter((part: any) => part !== undefined);
    if (content.length === 0) continue;
    if (message.role === "Assistant") appendAssistantTurn(out, content, model, timestamp);
    else out.push({ role: "user", content, timestamp });
  }
  return out;
}
