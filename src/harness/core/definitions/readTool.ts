import type { RunHost } from "../../contract";
import type { HostToolHandler } from "../CoreHarness";
import type { HostToolSpec } from "../SessionRecipe";
import type { ReadToolRunConfig } from "../readToolConfig";
import { RoutedSelectorModelInvoker, type SelectorModelInvoker } from "../semanticRead/modelInvoker";
import { semanticRead, smartReadTracer } from "../semanticRead/semanticRead";
import { NOOP_TOOL_EXECUTION_OBSERVER } from "../../contract/observability";
import { READ_FILE_TOOL, readTool } from "./exploreTools";

export const SEMANTIC_READ_FILE_TOOL: HostToolSpec = {
  name: "read_file",
  description:
    "Read the relevant portions of a file needed to answer a specific question. Provide a precise request describing the symbols, behavior, dependencies, or implementation details you need. The result may be an excerpt rather than the complete file. If the result is insufficient, make another read_file request with a more specific description.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "The file path to inspect." },
      request: { type: "string", description: "Precisely describe the code or information needed from this file." },
    },
    required: ["path", "request"],
    additionalProperties: false,
  },
};

export interface ReadFileToolDependencies {
  workspaceRoot: string;
  host: RunHost;
  inputFiles?: unknown;
  selectorInvoker?: SelectorModelInvoker;
}

export interface ResolvedReadFileTool {
  spec: HostToolSpec;
  description: string;
  handler: HostToolHandler;
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function resolveReadFileTool(config: ReadToolRunConfig | undefined, dependencies: ReadFileToolDependencies): ResolvedReadFileTool {
  if (!config || config.mode === "complete") {
    return {
      spec: READ_FILE_TOOL,
      description: "Read a file's content from the virtual workspace.",
      handler: readTool(dependencies.workspaceRoot, dependencies.host, dependencies.inputFiles),
    };
  }
  const selectorModel = config.selectorModel;
  const selectorProvider = selectorModel?.provider;
  if (!selectorModel || !selectorProvider) {
    throw new Error("Smart file reading is enabled, but no selector model is configured. Choose a provider and model or disable smart file reading.");
  }
  const completeHandler = readTool(dependencies.workspaceRoot, dependencies.host, dependencies.inputFiles);
  const invoker = dependencies.selectorInvoker ?? new RoutedSelectorModelInvoker();
  return {
    spec: SEMANTIC_READ_FILE_TOOL,
    description:
      "Read relevant excerpts from a file. Include path and a precise request describing the symbols, behavior, dependencies, or implementation details needed. The result may be partial; ask again with a more specific request if needed.",
    handler: async (args, signal, observer = NOOP_TOOL_EXECUTION_OBSERVER) => {
      const trace = smartReadTracer(dependencies.workspaceRoot, observer);
      const parsed = args as { path?: unknown; request?: unknown } | undefined;
      const path = typeof parsed?.path === "string" ? parsed.path : "";
      const request = typeof parsed?.request === "string" ? parsed.request.trim() : "";
      const selector = {
        providerId: selectorModel.providerId,
        modelId: selectorModel.modelId,
      };
      if (!path) {
        trace.warn("read_file rejected: missing path", { args });
        return { ok: false, error: "read_file requires a path." };
      }
      if (!request) {
        trace.warn("read_file rejected: missing request", { path });
        return { ok: false, error: "Smart read_file requires a precise request." };
      }
      observer.executedBy({
        kind: "model",
        purpose: "Smart Read selector",
        model: selector.modelId,
        provider: selectorProvider.name || selector.providerId,
        providerId: selector.providerId,
      });
      trace.info("semantic read_file started", { path, request, selector });
      const fullRead = await completeHandler({ path }, signal);
      if (!fullRead.ok) {
        trace.warn("underlying full read_file failed", { path, request, selector, error: fullRead.error });
        return fullRead;
      }
      const content = typeof fullRead.output === "string" ? fullRead.output : String(fullRead.output ?? "");
      trace.info("full file loaded for selector", { path, bytes: content.length, lines: content.split(/\r?\n/).length, selector });
      try {
        const output = await semanticRead({
          workspaceRoot: dependencies.workspaceRoot,
          path,
          request,
          content,
          selector: { ...selector, provider: selectorProvider },
          invoker,
          signal,
          observer,
        });
        trace.info("semantic read_file completed", { path, request, outputBytes: output.length, selector });
        return { ok: true, output };
      } catch (error: unknown) {
        const message = formatError(error);
        trace.warn("semantic read_file failed", { path, request, selector, error: message });
        return { ok: false, error: message };
      }
    },
  };
}
