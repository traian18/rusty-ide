import { invoke } from "@tauri-apps/api/core";
import { NOOP_TOOL_EXECUTION_OBSERVER } from "../../contract/observability";
import type { HostToolHandler } from "../CoreHarness";
import type { HostToolSpec } from "../SessionRecipe";
import type { WebExtractToolRunConfig } from "../webExtractToolConfig";
import { RoutedSelectorModelInvoker, type SelectorModelInvoker } from "../semanticRead/modelInvoker";
import { extractableLines, semanticWebExtract, smartWebExtractTracer, type FetchedPage } from "../semanticWebExtract/semanticWebExtract";

export const WEB_EXTRACT_TOOL: HostToolSpec = {
  name: "web_extract",
  description:
    "Extract the parts of a web page relevant to a specific question. Provide the page URL and a precise request describing the information you need. Returns verbatim excerpts with the source URL and section headings instead of the whole page. If the excerpts are insufficient, ask again with a more specific request, or use web_fetch for the complete page.",
  input_schema: {
    type: "object",
    properties: {
      url: { type: "string", description: "The http(s) URL of the page." },
      request: { type: "string", description: "Precisely describe the information needed from this page." },
    },
    required: ["url", "request"],
    additionalProperties: false,
  },
};

export interface WebExtractToolDependencies {
  workspaceRoot: string;
  selectorInvoker?: SelectorModelInvoker;
  /** Fetches the page privately; defaults to the same guarded fetch as `web_fetch`. */
  fetchPage?: (url: string) => Promise<FetchedPage>;
}

export interface ResolvedWebExtractTool {
  spec: HostToolSpec;
  handler: HostToolHandler;
}

async function fetchWithCoreGuards(url: string): Promise<FetchedPage> {
  const page = await invoke<{ content_type: string; content: string }>("harness_web_fetch", { url });
  return { contentType: page.content_type, content: page.content };
}

/** The Tauri fetch can't be aborted mid-flight (it is bounded by its own
 * timeout), so cancellation drops its late result instead. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error: unknown) => { signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
}

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** `undefined` when smart web extraction is off: the tool is not offered at all. */
export function resolveWebExtractTool(config: WebExtractToolRunConfig | undefined, dependencies: WebExtractToolDependencies): ResolvedWebExtractTool | undefined {
  if (!config?.enabled) return undefined;
  const selectorModel = config.selectorModel;
  const selectorProvider = selectorModel?.provider;
  if (!selectorModel || !selectorProvider) {
    throw new Error("Smart web extraction is enabled, but no selector model is configured. Choose a provider and model or disable smart web extraction.");
  }
  const invoker = dependencies.selectorInvoker ?? new RoutedSelectorModelInvoker();
  const fetchPage = dependencies.fetchPage ?? fetchWithCoreGuards;
  const selector = { providerId: selectorModel.providerId, modelId: selectorModel.modelId };

  return {
    spec: WEB_EXTRACT_TOOL,
    handler: async (args, signal, observer = NOOP_TOOL_EXECUTION_OBSERVER) => {
      const trace = smartWebExtractTracer(dependencies.workspaceRoot, observer);
      const parsed = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
      const url = httpUrl(parsed.url);
      const request = typeof parsed.request === "string" ? parsed.request.trim() : "";
      if (!url) {
        trace.warn("web_extract rejected: invalid url", { url: parsed.url });
        return { ok: false, error: "web_extract requires an http(s) url." };
      }
      if (!request) {
        trace.warn("web_extract rejected: missing request", { url });
        return { ok: false, error: "web_extract requires a precise request describing the information needed." };
      }
      let page: FetchedPage;
      try {
        page = await abortable(fetchPage(url), signal);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        trace.warn("page fetch failed", { url, error: message });
        return { ok: false, error: `Could not fetch ${url}: ${message}` };
      }
      try {
        extractableLines(url, page);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        trace.warn("page not extractable", { url, contentType: page.contentType, error: message });
        return { ok: false, error: message };
      }
      observer.executedBy({
        kind: "model",
        purpose: "Web Extract selector",
        model: selector.modelId,
        provider: selectorProvider.name || selector.providerId,
        providerId: selector.providerId,
      });
      try {
        const output = await semanticWebExtract({
          workspaceRoot: dependencies.workspaceRoot,
          url,
          request,
          page,
          selector: { ...selector, provider: selectorProvider },
          invoker,
          signal,
          observer,
        });
        return { ok: true, output };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        trace.warn("web_extract failed", { url, request, selector, error: message });
        return { ok: false, error: message };
      }
    },
  };
}
