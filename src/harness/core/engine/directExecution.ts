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

import type { CustomProvider } from "../../../store/types";
import type {
  ExecutionError,
  ExecutionEvent,
  ExecutionRequest,
  ExecutionResult,
  ModelUsage,
} from "./ExecutionProtocol";
import { recoverOpenRouterUsage } from "./openRouterUsageRecovery";
import { resolveDirectRuntime, type ResolvedDirectRuntime } from "./directRuntime";
import { withMistralRetries, type StreamProgress } from "./mistralRetries";
import { piMessagesFromAgentMessages, textFromPiMessage, toExecutionUsage } from "./piMessages";

// Which runtime a provider resolves to, and how Mistral failures are
// retried, live in their own modules; re-exported for this module's callers.
export { getProviderDefaults, isMistralUrl, normalizeApiType, resolveDirectRuntime } from "./directRuntime";
export { setMistralRetryDelaysForTests } from "./mistralRetries";

/** The `LlmApiType` values `directExecution.ts` ports pi-ai's own request
 * module for -- the three this app's own default providers actually use
 * (agent-sidecar/src/services/llmProviders.ts's `PROVIDER_DEFAULTS`).
 * `google-generative-ai` stays sidecar-only; `HybridExecutionAnswerer`
 * reads this set to decide whether a request can go direct at all. */
export const PORTED_API_TYPES = new Set(["openai-completions", "openai-responses", "anthropic-messages", "mistral-conversations"]);

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
  const runtime = resolveDirectRuntime(request.params?.model || "", customProvider);
  if (!runtime) throw new Error(`No API key is configured for ${customProvider.name}.`);

  const { streamSimple } = await import("@earendil-works/pi-ai/compat");
  signal.throwIfAborted();

  const controller = new AbortController();
  const turn: ModelTurn = {
    streamSimple,
    runtime,
    request,
    messages: piMessagesFromAgentMessages(request.messages, runtime.model),
    tools: piTools(request),
    signal: controller.signal,
    onEvent,
  };
  const abortListener = () => controller.abort();
  signal.addEventListener("abort", abortListener);

  try {
    const streamOnce = (progress: StreamProgress) => streamTurn(turn, progress);
    const result = runtime.model.api === "mistral-conversations"
      ? await withMistralRetries(streamOnce, signal)
      : await streamOnce({ emitted: false });
    const usage = await reportUsage(turn, result);
    const toolCalls = requestToolCalls(turn, result);
    return executionResult(request.request_id, result, usage, toolCalls);
  } finally {
    signal.removeEventListener("abort", abortListener);
  }
}

/** One model turn's request, and where its events go. */
interface ModelTurn {
  streamSimple: unknown;
  runtime: ResolvedDirectRuntime;
  request: ExecutionRequest;
  messages: any[];
  tools: Array<{ name: string; description: string; parameters: unknown }>;
  signal: AbortSignal;
  onEvent: (event: ExecutionEvent) => void;
}

function piTools(request: ExecutionRequest): ModelTurn["tools"] {
  return request.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema || { type: "object", properties: {}, required: [] },
  }));
}

/** Streams the model's answer, forwarding its text and reasoning as they arrive, and returns its final message. */
async function streamTurn(turn: ModelTurn, progress: StreamProgress): Promise<any> {
  const { runtime, request } = turn;
  const stream = (turn.streamSimple as any)(runtime.model, {
    systemPrompt: request.system_prompt,
    messages: turn.messages,
    tools: turn.tools,
  }, {
    apiKey: runtime.apiKey || undefined,
    headers: runtime.headers,
    signal: turn.signal,
    maxTokens: request.params?.max_tokens,
    temperature: request.params?.temperature,
    reasoning: request.params?.reasoning_effort || runtime.reasoningEffort,
  });
  let result: any;
  for await (const event of stream) {
    if (event.type === "done") result = event.message;
    else forwardStreamEvent(event, turn, progress);
  }
  return result || await stream.result();
}

function deltaEventKind(type: unknown): "TextDelta" | "ReasoningDelta" | undefined {
  if (type === "text_delta") return "TextDelta";
  if (type === "thinking_delta") return "ReasoningDelta";
  return undefined;
}

function forwardStreamEvent(event: any, turn: ModelTurn, progress: StreamProgress): void {
  if (event.type === "error") throw new Error(event.error?.errorMessage || "The model request failed.");
  const kind = deltaEventKind(event.type);
  // An empty delta (Mistral sends one with its error chunk) is not output.
  if (!kind || !event.delta) return;
  progress.emitted = true;
  turn.onEvent({ [kind]: { request_id: turn.request.request_id, delta: event.delta } } as ExecutionEvent);
}

/** The turn's token usage, recovered from OpenRouter when the stream left it out. */
async function reportUsage(turn: ModelTurn, result: any): Promise<ModelUsage> {
  const { runtime } = turn;
  let usage = toExecutionUsage(result?.usage);
  const recoveredUsage = await recoverOpenRouterUsage(
    runtime.providerId,
    runtime.model.baseUrl,
    runtime.apiKey,
    result?.responseId,
    usage,
    turn.signal,
  );
  if (recoveredUsage) usage = toExecutionUsage(recoveredUsage);
  turn.onEvent({ UsageUpdate: { request_id: turn.request.request_id, usage } });
  return usage;
}

/** Sends each tool call the model asked for, under a fresh UUID: rusty-core's `ToolCallId` is a UUID newtype. */
function requestToolCalls(turn: ModelTurn, result: any): any[] {
  const toolCalls = (result?.content || []).filter((part: any) => part?.type === "toolCall");
  for (const call of toolCalls) {
    turn.onEvent({
      ToolCallRequested: {
        request_id: turn.request.request_id,
        call: { id: crypto.randomUUID(), name: call.name, arguments: call.arguments || {} },
      },
    });
  }
  return toolCalls;
}

const OUTPUT_LIMIT_STOP_REASONS = ["length", "max_tokens", "max_output_tokens"];

function executionResult(requestId: string, result: any, usage: ModelUsage, toolCalls: any[]): ExecutionResult {
  const outputLimited = OUTPUT_LIMIT_STOP_REASONS.includes(result?.stopReason);
  // Preserve the stop reason so the harness can recover an incomplete turn,
  // including one whose entire budget was spent on reasoning/tool arguments.
  const empty = toolCalls.length === 0 && !textFromPiMessage(result).trim();
  if (empty && !outputLimited) throw new EmptyLlmResponseError(result);

  return {
    request_id: requestId,
    usage,
    cost: { amount_usd: null, source: null },
    finish_reason: toolCalls.length > 0 ? "tool_use" : String(result?.stopReason || "end_turn"),
    ...(typeof result?.responseId === "string" ? { response_id: result.responseId } : {}),
  };
}

export function toDirectExecutionError(error: unknown): ExecutionError {
  const message = error instanceof Error ? error.message : String(error);
  return { BackendError: { message, code: "DIRECT_EXECUTION_FAILED" } };
}
