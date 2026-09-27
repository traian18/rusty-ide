import { NOOP_TOOL_EXECUTION_OBSERVER, type ToolExecutionObserver } from "../../contract/observability";
import { logExecutionDiagnostic } from "../executionDiagnostics";
import type { CustomProvider } from "../../../store/types";
import type { SelectorModelInvoker } from "./modelInvoker";

export interface SelectedRange {
  startLine: number;
  endLine: number;
  reason?: string;
}

export interface SemanticReadOptions {
  workspaceRoot?: string;
  path: string;
  request: string;
  content: string;
  selector: {
    providerId: string;
    modelId: string;
    provider: CustomProvider;
  };
  invoker: SelectorModelInvoker;
  signal: AbortSignal;
  observer?: ToolExecutionObserver;
}

const MAX_RANGE_COUNT = 16;
const MAX_EXCERPT_LINES = 400;
const MAX_FILE_CHARS_FOR_SELECTOR = 180_000;

const SYSTEM_PROMPT = `You select exact source-code line ranges relevant to a user request.
Return only valid JSON with this shape: {"ranges":[{"startLine":1,"endLine":3,"reason":"short reason"}]}.
Use 1-based inclusive line numbers. Select only ranges that are needed, merge adjacent or overlapping ranges, return at most ${MAX_RANGE_COUNT} ranges, and keep their combined size at or below ${MAX_EXCERPT_LINES} lines. Do not rewrite, summarize, or quote source code.`;

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Every notable step goes to both the persisted diagnostics log and the
 * tool call's own observability trace. */
export function smartReadTracer(workspaceRoot: string | undefined, observer: ToolExecutionObserver) {
  return {
    info(message: string, details?: Record<string, unknown>) {
      logExecutionDiagnostic(workspaceRoot, "info", "SmartRead", message, details);
      observer.step("info", message, details);
    },
    warn(message: string, details?: Record<string, unknown>) {
      logExecutionDiagnostic(workspaceRoot, "warn", "SmartRead", message, details);
      observer.step("warn", message, details);
    },
  };
}

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("Selector returned invalid JSON.");
  }
}

export interface RangeLimits {
  maxRanges: number;
  maxLines: number;
}

export function validateRanges(
  value: unknown,
  totalLines: number,
  limits: RangeLimits = { maxRanges: MAX_RANGE_COUNT, maxLines: MAX_EXCERPT_LINES },
): SelectedRange[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { ranges?: unknown }).ranges)) {
    throw new Error("Selector response must contain a ranges array.");
  }
  const rawRanges = (value as { ranges: unknown[] }).ranges;
  if (rawRanges.length === 0) throw new Error("Selector did not return any relevant ranges.");

  const ranges = rawRanges.map((entry): SelectedRange => {
    if (!entry || typeof entry !== "object") throw new Error("Selector returned an invalid range entry.");
    const record = entry as Record<string, unknown>;
    const startLine = record.startLine;
    const endLine = record.endLine;
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) {
      throw new Error("Selector ranges must use integer startLine and endLine values.");
    }
    if ((startLine as number) < 1) throw new Error("Selector range startLine must be at least 1.");
    if ((endLine as number) < (startLine as number)) throw new Error("Selector range endLine must be greater than or equal to startLine.");
    if ((endLine as number) > totalLines) throw new Error(`Selector range endLine ${endLine} exceeds file length ${totalLines}.`);
    return {
      startLine: startLine as number,
      endLine: endLine as number,
      reason: typeof record.reason === "string" ? record.reason : undefined,
    };
  });

  ranges.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
  const normalized: SelectedRange[] = [];
  for (const range of ranges) {
    const previous = normalized[normalized.length - 1];
    if (previous && range.startLine <= previous.endLine + 1) {
      previous.endLine = Math.max(previous.endLine, range.endLine);
      previous.reason = [previous.reason, range.reason].filter(Boolean).join("; ") || undefined;
    } else {
      normalized.push({ ...range });
    }
  }
  if (normalized.length > limits.maxRanges) {
    throw new Error(`Selector returned too many disjoint ranges after normalization; maximum is ${limits.maxRanges}.`);
  }
  const totalExcerptLines = normalized.reduce((sum, range) => sum + range.endLine - range.startLine + 1, 0);
  if (totalExcerptLines > limits.maxLines) {
    throw new Error(`Selector ranges exceed the maximum excerpt size of ${limits.maxLines} lines.`);
  }
  return normalized;
}

function numberedContent(lines: string[]): string {
  return lines.map((line, index) => `${index + 1}: ${line}`).join("\n");
}

function buildUserPrompt(path: string, request: string, lines: string[]): string {
  const content = numberedContent(lines);
  const truncated = content.length > MAX_FILE_CHARS_FOR_SELECTOR
    ? `${content.slice(0, MAX_FILE_CHARS_FOR_SELECTOR)}\n[File content truncated for selection. Prefer visible line ranges only.]`
    : content;
  return `File path: ${path}\nTotal lines: ${lines.length}\nRequest: ${request}\n\nSource with line numbers:\n${truncated}`;
}

function formatExcerpts(path: string, request: string, content: string, ranges: SelectedRange[]): string {
  const lines = content.split(/\r?\n/);
  const parts = [
    `File: ${path}`,
    `Returned excerpt for request:`,
    request,
  ];
  for (const range of ranges) {
    const excerpt = lines.slice(range.startLine - 1, range.endLine).join("\n");
    parts.push("", `[lines ${range.startLine}-${range.endLine}]${range.reason ? ` ${range.reason}` : ""}`, excerpt);
  }
  return parts.join("\n");
}

export async function semanticRead(options: SemanticReadOptions): Promise<string> {
  options.signal.throwIfAborted();
  const observer = options.observer ?? NOOP_TOOL_EXECUTION_OBSERVER;
  const trace = smartReadTracer(options.workspaceRoot, observer);
  const lines = options.content.split(/\r?\n/);
  const selectorPrompt = buildUserPrompt(options.path, options.request, lines);
  trace.info("selector invocation started", {
    path: options.path,
    request: options.request,
    totalLines: lines.length,
    promptBytes: selectorPrompt.length,
    selector: { providerId: options.selector.providerId, modelId: options.selector.modelId },
  });
  const selectorOutput = await options.invoker.invoke({
    providerId: options.selector.providerId,
    modelId: options.selector.modelId,
    provider: options.selector.provider,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: selectorPrompt,
    signal: options.signal,
    workspaceRoot: options.workspaceRoot,
    onUsage: (usage) => observer.usage(usage),
  });
  options.signal.throwIfAborted();
  trace.info("selector invocation completed", {
    path: options.path,
    outputBytes: selectorOutput.length,
    selector: { providerId: options.selector.providerId, modelId: options.selector.modelId },
  });
  let parsed: unknown;
  try {
    parsed = extractJson(selectorOutput);
  } catch (error: unknown) {
    trace.warn("selector JSON parse failed", {
      path: options.path,
      outputPreview: selectorOutput.slice(0, 1_000),
      error: formatError(error),
    });
    throw error;
  }
  let ranges: SelectedRange[];
  try {
    ranges = validateRanges(parsed, lines.length);
  } catch (error: unknown) {
    trace.warn("selector range validation failed", {
      path: options.path,
      parsed,
      totalLines: lines.length,
      error: formatError(error),
    });
    throw error;
  }
  trace.info("selector ranges accepted", {
    path: options.path,
    ranges: ranges.map((range) => ({ startLine: range.startLine, endLine: range.endLine, reason: range.reason })),
  });
  return formatExcerpts(options.path, options.request, options.content, ranges);
}
