import type { AgentEventEnvelope } from "@rusty/harness-sdk";

import { mapProviderToIntegration } from "../providerMapping";
import type { SessionRecipe } from "../SessionRecipe";
import { CoreEngineClient, type BridgeEvent, type CoreEngine } from "../engine/CoreEngineClient";
import { DirectExecutionAnswerer } from "../engine/DirectExecutionAnswerer";
import type { ExecutionError, ExecutionEvent, ExecutionRequest, ExecutionResult } from "../engine/ExecutionProtocol";
import { isExecutionError } from "../engine/ExecutionProtocol";
import type { ExecutionAnswerer } from "../CoreHarness";
import type { CustomProvider } from "../../../store/types";
import type { TokenUsage } from "../../contract";
import { hasTokens, mapAgentUsage, mapModelUsage, UsageAccumulator, usageRequestKey } from "../usageAccumulator";

export interface SelectorModelRequest {
  providerId: string;
  modelId: string;
  provider: CustomProvider;
  systemPrompt: string;
  userPrompt: string;
  signal: AbortSignal;
  workspaceRoot?: string;
  /** Receives the selector session's token usage, once per model request. */
  onUsage?: (usage: TokenUsage) => void;
}

export interface SelectorModelInvoker {
  invoke(request: SelectorModelRequest): Promise<string>;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function toExecutionError(error: unknown): ExecutionError {
  if (isExecutionError(error)) return error;
  return { BackendError: { message: errorMessage(error), code: "SELECTOR_MODEL_EXECUTION_FAILED" } };
}

function makeRequest(request: SelectorModelRequest): ExecutionRequest {
  const requestId = crypto.randomUUID();
  return {
    request_id: requestId,
    run_id: requestId,
    system_prompt: request.systemPrompt,
    messages: [
      {
        id: crypto.randomUUID(),
        role: "User",
        content: [{ Text: { text: request.userPrompt } }],
        created_at: new Date().toISOString(),
      },
    ],
    tools: [],
    extended_thinking: false,
    params: {
      model: request.modelId,
      max_tokens: 4096,
      temperature: 0,
    },
  };
}

function selectorRecipe(request: SelectorModelRequest): SessionRecipe {
  const mapped = mapProviderToIntegration(request.provider, request.modelId);
  if (!mapped.supported) {
    throw new Error(`Smart Read selector provider is not supported: ${mapped.reason}`);
  }
  return {
    workspace: { root: request.workspaceRoot || "", binding: "host" },
    integration: mapped.integration,
    integration_config: mapped.integration_config,
    system_prompt: request.systemPrompt,
    host_tools: [],
    execution_params: {
      model: mapped.model ?? request.modelId,
      max_tokens: 4096,
      temperature: 0,
      ...(mapped.reasoningEffort ? { reasoning_effort: mapped.reasoningEffort } : {}),
    },
  };
}

/**
 * Legacy direct-only invoker retained for tests/overrides. Production Smart
 * Read uses RoutedSelectorModelInvoker so managed providers (Codex/Copilot)
 * and host-routed HTTP providers share the same abstraction as normal runs.
 */
export class DirectSelectorModelInvoker implements SelectorModelInvoker {
  private readonly answerer = new DirectExecutionAnswerer();

  async invoke(request: SelectorModelRequest): Promise<string> {
    let text = "";
    await this.answerer.execute(
      makeRequest(request),
      request.provider,
      (event) => {
        if ("TextDelta" in event) text += event.TextDelta.delta;
      },
      request.signal,
    ).then((result) => {
      // The result carries the request's final usage: exactly one increment.
      const usage = mapModelUsage(result.usage);
      if (hasTokens(usage)) request.onUsage?.(usage);
    });
    return text;
  }
}

export class RoutedSelectorModelInvoker implements SelectorModelInvoker {
  private readonly engine: CoreEngine;
  private readonly executionAnswerer: ExecutionAnswerer;

  constructor(options: { engine?: CoreEngine; executionAnswerer?: ExecutionAnswerer } = {}) {
    this.engine = options.engine ?? new CoreEngineClient();
    this.executionAnswerer = options.executionAnswerer ?? new DirectExecutionAnswerer();
  }

  invoke(request: SelectorModelRequest): Promise<string> {
    const recipe = selectorRecipe(request);
    const promptText = request.userPrompt;
    const controller = new AbortController();
    const abortFromParent = () => controller.abort();
    let sessionId: string | undefined;
    let settled = false;
    let text = "";
    const usage = new UsageAccumulator();

    if (request.signal.aborted) controller.abort();
    request.signal.addEventListener("abort", abortFromParent);

    return new Promise<string>((resolve, reject) => {
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        // A selector session is one model request: report what it spent
        // once, whether it succeeded, failed, or was cancelled.
        const spent = usage.total();
        if (hasTokens(spent)) request.onUsage?.(spent);
        request.signal.removeEventListener("abort", abortFromParent);
        controller.signal.removeEventListener("abort", abortListener);
        fn();
        if (sessionId) void this.engine.closeSession(sessionId).catch(() => {});
      };

      const abortListener = () => finish(() => reject(new DOMException("Aborted", "AbortError")));
      controller.signal.addEventListener("abort", abortListener);

      const handleHostExecuteCall = (data: { call_id: string; tool: string; input: ExecutionRequest }) => {
        if (!sessionId) return;
        const sid = sessionId;
        let delivery: Promise<void> = Promise.resolve();
        const enqueue = (send: () => Promise<void>) => {
          delivery = delivery.then(send).catch(() => {});
          return delivery;
        };
        this.executionAnswerer
          .execute(
            data.input,
            request.provider,
            (event: ExecutionEvent) => {
              void enqueue(() => this.engine.hostExecuteEvent(sid, data.call_id, event));
            },
            controller.signal,
          )
          .then(
            (result: ExecutionResult) => enqueue(() => this.engine.hostExecuteResult(sid, data.call_id, { ok: true, result })),
            (error: unknown) => enqueue(() => this.engine.hostExecuteResult(sid, data.call_id, { ok: false, error: toExecutionError(error) })),
          )
          .catch(() => {});
      };

      const handleAgentEvent = (envelope: AgentEventEnvelope) => {
        const event = envelope.event as any;
        if ("AssistantTextDelta" in event) {
          text += String(event.AssistantTextDelta.delta ?? "");
          return;
        }
        if ("UsageUpdated" in event) {
          usage.apply(usageRequestKey(event.UsageUpdated.usage), mapAgentUsage(event.UsageUpdated.usage));
          return;
        }
        if ("Failed" in event) {
          finish(() => reject(new Error(event.Failed.error?.message || "Smart Read selector model failed.")));
          return;
        }
        if ("Completed" in event) {
          const outcome = event.Completed.outcome;
          if (outcome === "Success") {
            finish(() => resolve(text));
          } else if (outcome === "Cancelled") {
            finish(() => reject(new DOMException("Aborted", "AbortError")));
          } else {
            finish(() => reject(new Error("Smart Read selector model failed.")));
          }
        }
      };

      const handleBridgeEvent = (bridgeEvent: BridgeEvent) => {
        if (settled) return;
        switch (bridgeEvent.kind) {
          case "event":
            handleAgentEvent(bridgeEvent.data);
            return;
          case "host_execute_call":
            handleHostExecuteCall(bridgeEvent.data);
            return;
          case "host_tool_call":
            if (sessionId) {
              void this.engine
                .hostToolResult(sessionId, bridgeEvent.data.call_id, { ok: false, error: "Smart Read selector sessions do not expose tools." })
                .catch(() => {});
            }
            return;
          case "closed":
            finish(() => reject(new Error(bridgeEvent.data.reason)));
            return;
          case "gap":
            return;
        }
      };

      void (async () => {
        try {
          if (controller.signal.aborted) {
            abortListener();
            return;
          }
          sessionId = await this.engine.createSession(recipe);
          if (settled) {
            void this.engine.closeSession(sessionId).catch(() => {});
            return;
          }
          await this.engine.subscribe(sessionId, handleBridgeEvent);
          await this.engine.mutate(sessionId, { type: "prompt", payload: { text: promptText, attachments: [] } });
        } catch (error: unknown) {
          finish(() => reject(error instanceof Error ? error : new Error(errorMessage(error))));
        }
      })();
    });
  }
}
