// ============================================================
// directExecution.ts — Phase 2 of the Host-routed execution backend plan:
// answers one `ExecutionRequest` by calling pi-ai's per-provider request
// modules directly from the IDE process, instead of proxying it to the Node
// sidecar's `backend_execute` WS route (Phase 1, SidecarExecutionAnswerer).
//
// This is a deliberate PORT, not a shared import, of the `customProvider`
// branch of agent-sidecar/src/services/llmRuntime.ts's `resolveLlmRuntime`/
// `streamExecutionRequest` and the matching pieces of llmProviders.ts --
// same boundary-crossing pattern already established this project
// (definitions/promptHistory.ts's own precedent): the sidecar and the IDE
// frontend are two separate TS projects/runtimes, so code crossing that
// boundary is ported with attribution, not imported across it.
//
// Only the `customProvider` branch is ported. `resolveLlmRuntime`'s other
// branch (looking up a model from pi-ai's built-in catalog via
// `importEsm("@earendil-works/pi-ai/compat").getModel`) is genuinely dead
// code on this path: every host-routed capability's `ExecutionRequest`
// always carries a `customProvider` (every CoreCapabilityDefinition passes
// `input.customProvider` straight through -- see CoreHarness.ts's
// `handleHostExecuteCall`), so that branch never runs here. This is also
// why `esmImport.ts`'s Node-only dynamic-import loader -- the presumed
// Phase 2 blocker -- turned out not to apply: it's only reachable from the
// branch this app never takes.
//
// One narrower gap than the sidecar's own `resolveProviderApiKey`,
// documented rather than silently matched: the sidecar falls back to
// `process.env[envVar]` (e.g. `ANTHROPIC_API_KEY`) when a provider has no
// explicit `apiKey`. That fallback is sidecar-process-only and has no
// browser equivalent. A provider relying on it resolves no key here
// (`resolveDirectApiKey` returns ""), which `HybridExecutionAnswerer`
// (../../HybridExecutionAnswerer.ts) treats as "not ported" and routes to
// the sidecar fallback instead -- see its own doc comment.
// ============================================================

import type { CustomProvider, ProviderModel } from "../../../store/types";
import { parseModelReference } from "../../../store/providerHelpers";
import type {
  AgentMessage,
  ExecutionError,
  ExecutionEvent,
  ExecutionRequest,
  ExecutionResult,
  ModelUsage,
} from "./ExecutionProtocol";

/** The `LlmApiType` values `directExecution.ts` ports pi-ai's own request
 * module for -- the three this app's own default providers actually use
 * (agent-sidecar/src/services/llmProviders.ts's `PROVIDER_DEFAULTS`).
 * `google-generative-ai` stays sidecar-only; `HybridExecutionAnswerer`
 * reads this set to decide whether a request can go direct at all. */
export const PORTED_API_TYPES = new Set(["openai-completions", "openai-responses", "anthropic-messages"]);

/** Provider ids whose *execution* endpoint has no CORS support at all --
 * confirmed live, not assumed: `curl -X OPTIONS https://opencode.ai/zen/v1/
 * chat/completions -H "Origin: tauri://localhost" ...` (and the `/zen/go/v1/`
 * twin) returns no `access-control-*` headers and a bare 404, meaning any
 * browser `fetch()` to it is blocked by the browser itself before a real
 * response is even seen -- surfaced here as the openai SDK's generic
 * `APIConnectionError`/"Connection error." (node_modules/openai/core/
 * error.js), since a CORS rejection looks identical to a network failure
 * from `fetch`'s own perspective. OpenAI's and Anthropic's official APIs
 * were checked the same way and do return real `access-control-allow-*`
 * headers -- this is a genuine per-provider server-side gap, not something
 * fixable from this side of the request. Their *catalog* endpoint
 * (`/models`) is unaffected (confirmed with the same curl check: it does
 * return `access-control-allow-origin: *`), so `providerCatalog.ts`/
 * `HybridControlPlane.ts` do not need this same exclusion -- only
 * `HybridExecutionAnswerer` reads this set. */
export const NO_CORS_EXECUTION_PROVIDER_IDS = new Set(["opencode", "opencode-go"]);

interface ProviderDefaults {
  baseUrl: string;
  authType: "bearer" | "anthropic" | "none" | "environment";
  apiType: string;
}

/** Mirrors agent-sidecar/src/services/llmProviders.ts's own
 * `PROVIDER_DEFAULTS` -- only the fields this module actually reads
 * (`baseUrl`/`authType`/`apiType`; the sidecar's own `catalogUrl`/`envVar`/
 * `piProvider` fields belong to catalog discovery and the env-var fallback,
 * neither of which this module does). Kept as a separate literal rather
 * than imported: same reasoning as the rest of this file's port. */
const PROVIDER_DEFAULTS: Record<string, ProviderDefaults> = {
  opencode: { baseUrl: "https://opencode.ai/zen/v1", authType: "bearer", apiType: "openai-completions" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", authType: "bearer", apiType: "openai-completions" },
  "opencode-go": { baseUrl: "https://opencode.ai/zen/go/v1", authType: "bearer", apiType: "openai-completions" },
  openai: { baseUrl: "https://api.openai.com/v1", authType: "bearer", apiType: "openai-responses" },
  anthropic: { baseUrl: "https://api.anthropic.com/v1", authType: "anthropic", apiType: "anthropic-messages" },
  "github-models": { baseUrl: "https://models.github.ai/inference", authType: "bearer", apiType: "openai-completions" },
};

export function getProviderDefaults(providerId: string): ProviderDefaults | undefined {
  return PROVIDER_DEFAULTS[providerId];
}

export function normalizeApiType(apiType?: string): string {
  if (apiType === "anthropic") return "anthropic-messages";
  return apiType || "openai-completions";
}

function remoteModelId(modelId: string, providerId: string): string {
  const prefix = `${providerId}/`;
  return modelId.startsWith(prefix) ? modelId.slice(prefix.length) : modelId;
}

function resolveProviderModelSelection(
  provider: CustomProvider,
  modelReference: string,
): { model?: ProviderModel; modelId: string; reasoningEffort?: string } {
  const parsed = parseModelReference(modelReference);
  const target = remoteModelId(parsed.baseReference, provider.id);
  const model = provider.models.find((candidate) => candidate.id === parsed.baseReference)
    || provider.models.find((candidate) => (candidate.remoteId || remoteModelId(candidate.id, provider.id)) === target);
  return {
    model,
    modelId: model?.remoteId || target,
    reasoningEffort: parsed.reasoningEffort || model?.reasoningEffort,
  };
}

/** Only the explicit-key half of the sidecar's own `resolveProviderApiKey`
 * -- see this file's own top doc comment for why the `process.env` fallback
 * is intentionally dropped rather than ported. */
function resolveDirectApiKey(provider: CustomProvider): string {
  return provider.apiKey?.trim() || "";
}

function syntheticModel(provider: CustomProvider, configuredModel: ProviderModel | undefined, modelId: string): any {
  const defaults = getProviderDefaults(provider.id);
  const api = normalizeApiType(configuredModel?.apiType || provider.apiType || defaults?.apiType);
  const baseUrl = (configuredModel?.baseUrl || provider.baseUrl || defaults?.baseUrl || "").replace(/\/+$/, "");
  if (!baseUrl) throw new Error(`No base URL is configured for ${provider.name}.`);
  return {
    id: modelId,
    name: configuredModel?.name || modelId,
    api,
    provider: provider.id,
    baseUrl,
    reasoning: configuredModel?.reasoning ?? false,
    thinkingLevelMap: configuredModel?.thinkingLevelMap,
    thinkingBudgets: configuredModel?.thinkingBudgets,
    input: configuredModel?.input || ["text"],
    cost: configuredModel?.cost || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: configuredModel?.contextWindow || 200_000,
    maxTokens: configuredModel?.maxTokens || 16_384,
    compat: configuredModel?.compat,
    headers: configuredModel?.headers,
  };
}

function runtimeHeaders(
  provider: CustomProvider,
  model: any,
  apiKey: string,
  authType?: CustomProvider["authType"],
): Record<string, string> | undefined {
  const headers: Record<string, string> = { ...(model.headers || {}) };
  if (provider.id === "github-models") {
    headers.Accept = "application/vnd.github+json";
    headers["X-GitHub-Api-Version"] = "2026-03-10";
  } else if (provider.id === "openrouter") {
    headers["HTTP-Referer"] = "https://rusty.dev";
    headers["X-Title"] = "Rusty";
  }
  if (model.api === "anthropic-messages" && authType === "bearer" && apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return Object.keys(headers).length ? headers : undefined;
}

interface ResolvedDirectRuntime {
  providerId: string;
  modelId: string;
  apiKey: string;
  model: any;
  headers?: Record<string, string>;
  reasoningEffort?: string;
}

/** Twin of `resolveLlmRuntime`'s `customProvider` branch (llmRuntime.ts:
 * 122-170) -- the only branch this app's own call pattern ever takes (see
 * this file's top doc comment). Returns `undefined` rather than throwing
 * when no API key resolves, so `HybridExecutionAnswerer` can fall back to
 * the sidecar instead of surfacing a hard error for a provider that relies
 * on the sidecar's own env-var fallback. */
export function resolveDirectRuntime(modelReference: string, provider: CustomProvider): ResolvedDirectRuntime | undefined {
  const fallbackModel = provider.models[0];
  const fallbackReference = modelReference || fallbackModel?.id || fallbackModel?.remoteId || "";
  const selection = resolveProviderModelSelection(provider, fallbackReference);
  const modelId = selection.modelId;
  if (!modelId) return undefined;

  const model = syntheticModel(provider, selection.model || fallbackModel, modelId);

  const authType = provider.authType
    || getProviderDefaults(provider.id)?.authType
    || (provider.apiKey ? "bearer" : "none");
  const apiKey = resolveDirectApiKey(provider) || (authType === "none" ? "not-needed" : "");
  if (!apiKey) return undefined;

  return {
    providerId: provider.id,
    modelId,
    apiKey,
    model,
    headers: runtimeHeaders(provider, model, apiKey, authType),
    reasoningEffort: selection.reasoningEffort,
  };
}

class EmptyLlmResponseError extends Error {
  constructor(message: any) {
    const stopReason = typeof message?.stopReason === "string" ? message.stopReason : "unknown";
    const reason = stopReason === "length"
      ? "The selected model exhausted its output token budget before returning text."
      : "The selected model returned no text.";
    super(`${reason} (stop reason: ${stopReason})`);
    this.name = "EmptyLlmResponseError";
  }
}

function textFromPiMessage(message: any): string {
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

function toExecutionUsage(sample: any): ModelUsage {
  return {
    input_tokens: sample?.input ?? null,
    output_tokens: sample?.output ?? null,
    cache_read_tokens: sample?.cacheRead ?? null,
    cache_write_tokens: sample?.cacheWrite ?? null,
    reasoning_tokens: sample?.reasoning ?? null,
    total_tokens: sample?.totalTokens ?? null,
  };
}

/** Verbatim port of llmRuntime.ts's own `piMessagesFromAgentMessages` --
 * see its doc comment there for why the merge-consecutive-Assistant-
 * messages and full-AssistantMessage-shape behavior exist (two real bugs
 * found live-testing execute_node against Phase 1). */
function piMessagesFromAgentMessages(messages: AgentMessage[], model: any): any[] {
  const toolNamesByCallId = new Map<string, string>();
  const out: any[] = [];
  for (const message of messages as any[]) {
    const timestamp = Date.parse(message.created_at) || Date.now();
    if (message.role === "Tool") {
      for (const block of message.content) {
        if (!("ToolResult" in block)) continue;
        const { call_id, result } = block.ToolResult;
        out.push({
          role: "toolResult",
          toolCallId: call_id,
          toolName: toolNamesByCallId.get(call_id) || "",
          content: [{ type: "text", text: toolOutputText(result.output_preview) }],
          details: {},
          isError: result.has_error,
          timestamp,
        });
      }
      continue;
    }
    const content: any[] = [];
    for (const block of message.content) {
      if ("Text" in block) {
        content.push({ type: "text", text: block.Text.text });
      } else if ("ToolUse" in block) {
        const { id, name, arguments: args } = block.ToolUse.call;
        toolNamesByCallId.set(id, name);
        content.push({ type: "toolCall", id, name, arguments: args ?? {} });
      } else if ("ToolResult" in block) {
        content.push({ type: "text", text: toolOutputText(block.ToolResult.result.output_preview) });
      } else if ("Image" in block) {
        content.push({ type: "text", text: "[image omitted]" });
      }
    }
    if (content.length === 0) continue;
    if (message.role === "Assistant") {
      const previous = out[out.length - 1];
      if (previous?.role === "assistant") {
        previous.content.push(...content);
        if (content.some((part) => part.type === "toolCall")) previous.stopReason = "toolUse";
        previous.timestamp = Math.max(previous.timestamp, timestamp);
        continue;
      }
      out.push({
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
        stopReason: content.some((part) => part.type === "toolCall") ? "toolUse" : "stop",
        timestamp,
      });
      continue;
    }
    out.push({ role: "user", content, timestamp });
  }
  return out;
}

/** Direct twin of agent-sidecar/src/services/llmRuntime.ts's own
 * `streamExecutionRequest` -- same event translation, same UUID tool-call-
 * id minting (rusty-core's `ToolCallId` is a UUID newtype; see that
 * function's own doc comment for the bug this works around), calling
 * pi-ai's `compat.js` `streamSimple` via a real import instead of the
 * sidecar's Node-only `importEsm`. Throws when `resolveDirectRuntime`
 * cannot resolve a runtime (no API key, no base URL, etc.) -- the caller
 * (`HybridExecutionAnswerer`) is expected to have already checked
 * `resolveDirectRuntime` returns something before calling this, so this
 * should only throw for a genuine request-time failure.
 */
export async function runDirectExecution(
  request: ExecutionRequest,
  customProvider: CustomProvider,
  onEvent: (event: ExecutionEvent) => void,
  signal: AbortSignal,
): Promise<ExecutionResult> {
  signal.throwIfAborted();
  const requestId = request.request_id;
  const modelReference = request.params?.model || "";
  const runtime = resolveDirectRuntime(modelReference, customProvider);
  if (!runtime) throw new Error(`No API key is configured for ${customProvider.name}.`);

  const { streamSimple } = await import("@earendil-works/pi-ai/compat");
  signal.throwIfAborted();

  const messages = piMessagesFromAgentMessages(request.messages, runtime.model);
  const tools = request.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema || { type: "object", properties: {}, required: [] },
  }));

  const controller = new AbortController();
  const abortListener = () => controller.abort();
  signal.addEventListener("abort", abortListener);

  try {
    const stream = (streamSimple as any)(runtime.model, {
      systemPrompt: request.system_prompt,
      messages,
      tools,
    }, {
      apiKey: runtime.apiKey || undefined,
      headers: runtime.headers,
      signal: controller.signal,
      maxTokens: request.params?.max_tokens,
      temperature: request.params?.temperature,
      reasoning: request.params?.reasoning_effort || runtime.reasoningEffort,
    });

    let result: any;
    for await (const event of stream) {
      if (event.type === "text_delta") {
        onEvent({ TextDelta: { request_id: requestId, delta: event.delta } });
      } else if (event.type === "thinking_delta") {
        onEvent({ ReasoningDelta: { request_id: requestId, delta: event.delta } });
      } else if (event.type === "error") {
        throw new Error(event.error?.errorMessage || "The model request failed.");
      } else if (event.type === "done") {
        result = event.message;
      }
    }
    result ||= await stream.result();

    const usage = toExecutionUsage(result?.usage);
    onEvent({ UsageUpdate: { request_id: requestId, usage } });

    const toolCalls = (result?.content || []).filter((part: any) => part?.type === "toolCall");
    for (const call of toolCalls) {
      onEvent({
        ToolCallRequested: {
          request_id: requestId,
          call: { id: crypto.randomUUID(), name: call.name, arguments: call.arguments || {} },
        },
      });
    }

    const text = textFromPiMessage(result);
    const outputLimited = ["length", "max_tokens", "max_output_tokens"].includes(result?.stopReason);
    // Preserve the stop reason so the harness can recover an incomplete turn,
    // including one whose entire budget was spent on reasoning/tool arguments.
    if (toolCalls.length === 0 && !text.trim() && !outputLimited) throw new EmptyLlmResponseError(result);

    return {
      request_id: requestId,
      usage,
      cost: { amount_usd: null, source: null },
      finish_reason: toolCalls.length > 0 ? "tool_use" : String(result?.stopReason || "end_turn"),
    };
  } finally {
    signal.removeEventListener("abort", abortListener);
  }
}

export function toDirectExecutionError(error: unknown): ExecutionError {
  const message = error instanceof Error ? error.message : String(error);
  return { BackendError: { message, code: "DIRECT_EXECUTION_FAILED" } };
}
