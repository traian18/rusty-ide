import { NOOP_TOOL_EXECUTION_OBSERVER, type ToolExecutionObserver } from "../../contract/observability";
import { logExecutionDiagnostic } from "../executionDiagnostics";
import type { CustomProvider } from "../../../store/types";
import type { SearchMatch } from "../../../services/searchService";
import type { SelectorModelInvoker } from "../semanticRead/modelInvoker";

export interface SearchQuery {
  pattern: string;
  regex: boolean;
  reason?: string;
}

export interface RankedMatch {
  path: string;
  line: number;
  content: string;
  /** How many distinct generated patterns hit this line. */
  hits: number;
  /** Index of the first (most specific, per the selector's order) pattern that hit it. */
  firstQuery: number;
}

export interface SemanticSearchOptions {
  workspaceRoot: string;
  request: string;
  /** Workspace-relative directory or file the results must fall under. */
  path?: string;
  /** Glob such as `*.ts` or `src/**\/*.rs`. */
  include?: string;
  maxResults?: number;
  selector: {
    providerId: string;
    modelId: string;
    provider: CustomProvider;
  };
  invoker: SelectorModelInvoker;
  /** The deterministic line search, e.g. the workspace's ripgrep-backed search. */
  search: (pattern: string, isRegex: boolean) => Promise<SearchMatch[]>;
  signal: AbortSignal;
  observer?: ToolExecutionObserver;
}

export const DEFAULT_MAX_RESULTS = 30;
export const MAX_RESULTS_LIMIT = 50;
const MAX_QUERIES = 6;
const MAX_PATTERN_CHARS = 200;
const MAX_MATCHES_PER_FILE = 5;
const MAX_SNIPPET_CHARS = 200;
const MAX_OUTPUT_CHARS = 12_000;

const SYSTEM_PROMPT = `You turn a code-search request into search patterns for a line-based, case-insensitive search over a source-code workspace.
Return only valid JSON with this shape: {"queries":[{"pattern":"validateConfig","regex":false,"reason":"short reason"}]}.
Each pattern is matched against single lines. Prefer distinctive identifiers, function/type/method names, error message fragments, and string literals likely to appear in the relevant lines. Use "regex": true only for simple regular expressions that must span naming variants (e.g. "auth(entication)?Error"). Order patterns from most to least specific. Return between 1 and ${MAX_QUERIES} patterns. Do not return explanations outside the JSON.`;

export function smartSearchTracer(workspaceRoot: string | undefined, observer: ToolExecutionObserver) {
  return {
    info(message: string, details?: Record<string, unknown>) {
      logExecutionDiagnostic(workspaceRoot, "info", "SmartSearch", message, details);
      observer.step("info", message, details);
    },
    warn(message: string, details?: Record<string, unknown>) {
      logExecutionDiagnostic(workspaceRoot, "warn", "SmartSearch", message, details);
      observer.step("warn", message, details);
    },
  };
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("Search selector returned invalid JSON.");
  }
}

export function validateQueries(value: unknown): SearchQuery[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { queries?: unknown }).queries)) {
    throw new Error("Search selector response must contain a queries array.");
  }
  const raw = (value as { queries: unknown[] }).queries;
  if (raw.length === 0) throw new Error("Search selector did not return any search patterns.");
  if (raw.length > MAX_QUERIES) throw new Error(`Search selector returned too many patterns; maximum is ${MAX_QUERIES}.`);
  const seen = new Set<string>();
  const queries: SearchQuery[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") throw new Error("Search selector returned an invalid pattern entry.");
    const record = entry as Record<string, unknown>;
    const pattern = typeof record.pattern === "string" ? record.pattern.trim() : "";
    if (!pattern) throw new Error("Search selector patterns must be non-empty strings.");
    if (pattern.length > MAX_PATTERN_CHARS) throw new Error(`Search selector pattern exceeds ${MAX_PATTERN_CHARS} characters.`);
    const regex = record.regex === true;
    const key = `${regex}:${pattern.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push({ pattern, regex, reason: typeof record.reason === "string" ? record.reason : undefined });
  }
  return queries;
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function relativeTo(workspaceRoot: string, path: string): string {
  const root = normalizeSlashes(workspaceRoot).replace(/\/+$/, "");
  const normalized = normalizeSlashes(path);
  return normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : normalized;
}

/** Converts a glob (`*`, `**`, `?`, `{a,b}`) into an anchored RegExp. */
export function globToRegExp(glob: string): RegExp {
  let source = "";
  let braceDepth = 0;
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index];
    if (char === "*") {
      if (glob[index + 1] === "*") {
        const followedBySlash = glob[index + 2] === "/";
        source += followedBySlash ? "(?:.*/)?" : ".*";
        index += followedBySlash ? 2 : 1;
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") source += "[^/]";
    else if (char === "{") { braceDepth++; source += "(?:"; }
    else if (char === "}" && braceDepth > 0) { braceDepth--; source += ")"; }
    else if (char === "," && braceDepth > 0) source += "|";
    else source += char.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

function scopeFilter(path: string | undefined, include: string | undefined): (relativePath: string) => boolean {
  const scope = path ? normalizeSlashes(path).replace(/^\.\/?/, "").replace(/\/+$/, "") : "";
  const includeRe = include ? globToRegExp(normalizeSlashes(include)) : undefined;
  const includeMatchesBasename = Boolean(include && !include.includes("/"));
  return (relativePath) => {
    if (scope && relativePath !== scope && !relativePath.startsWith(`${scope}/`)) return false;
    if (!includeRe) return true;
    const target = includeMatchesBasename ? relativePath.slice(relativePath.lastIndexOf("/") + 1) : relativePath;
    return includeRe.test(target);
  };
}

/** Deterministic: more distinct pattern hits first, then earlier (more
 * specific) pattern, then path and line. At most MAX_MATCHES_PER_FILE lines
 * per file so one noisy file cannot crowd out the rest. */
export function rankMatches(matches: Map<string, RankedMatch>): RankedMatch[] {
  const ordered = [...matches.values()].sort((a, b) =>
    b.hits - a.hits || a.firstQuery - b.firstQuery || a.path.localeCompare(b.path) || a.line - b.line);
  const perFile = new Map<string, number>();
  return ordered.filter((match) => {
    const count = perFile.get(match.path) ?? 0;
    if (count >= MAX_MATCHES_PER_FILE) return false;
    perFile.set(match.path, count + 1);
    return true;
  });
}

function formatResults(options: SemanticSearchOptions, ranked: RankedMatch[], maxResults: number): { output: string; returned: number } {
  const scope = [options.path, options.include && `(${options.include})`].filter(Boolean).join(" ");
  const header = [`Search results for request:`, options.request];
  if (scope) header.push(`Scope: ${scope}`);
  if (ranked.length === 0) {
    return { output: [...header, "", "No relevant matches found. Try describing different symbols or behavior, or widen the scope."].join("\n"), returned: 0 };
  }
  const lines: string[] = [];
  let size = header.join("\n").length;
  for (const match of ranked.slice(0, maxResults)) {
    const line = `${match.path}:${match.line} | ${match.content.trim().slice(0, MAX_SNIPPET_CHARS)}`;
    if (size + line.length + 1 > MAX_OUTPUT_CHARS) break;
    lines.push(line);
    size += line.length + 1;
  }
  header.push(`Showing ${lines.length} of ${ranked.length} relevant matches, most relevant first. Use read_file for surrounding code.`);
  return { output: [...header, "", ...lines].join("\n"), returned: lines.length };
}

export async function semanticSearch(options: SemanticSearchOptions): Promise<string> {
  options.signal.throwIfAborted();
  const observer = options.observer ?? NOOP_TOOL_EXECUTION_OBSERVER;
  const trace = smartSearchTracer(options.workspaceRoot, observer);
  const maxResults = Math.min(Math.max(1, Math.floor(options.maxResults ?? DEFAULT_MAX_RESULTS)), MAX_RESULTS_LIMIT);
  const selector = { providerId: options.selector.providerId, modelId: options.selector.modelId };

  const userPrompt = [
    `Request: ${options.request}`,
    options.path ? `Search scope (workspace-relative): ${options.path}` : undefined,
    options.include ? `File filter: ${options.include}` : undefined,
  ].filter(Boolean).join("\n");
  trace.info("pattern generation started", { request: options.request, path: options.path, include: options.include, selector });
  const selectorOutput = await options.invoker.invoke({
    providerId: options.selector.providerId,
    modelId: options.selector.modelId,
    provider: options.selector.provider,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    signal: options.signal,
    workspaceRoot: options.workspaceRoot,
    onUsage: (usage) => observer.usage(usage),
  });
  options.signal.throwIfAborted();

  let queries: SearchQuery[];
  try {
    queries = validateQueries(extractJson(selectorOutput));
  } catch (error: unknown) {
    trace.warn("search pattern validation failed", {
      outputPreview: selectorOutput.slice(0, 1_000),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  trace.info("search patterns generated", { queries });

  const inScope = scopeFilter(options.path, options.include);
  const matches = new Map<string, RankedMatch>();
  for (const [queryIndex, query] of queries.entries()) {
    options.signal.throwIfAborted();
    const found = (await options.search(query.pattern, query.regex)).filter((match) => match.is_content_match);
    let kept = 0;
    for (const match of found) {
      const path = relativeTo(options.workspaceRoot, match.path);
      if (!inScope(path)) continue;
      kept++;
      const key = `${path}:${match.line}`;
      const existing = matches.get(key);
      if (existing) existing.hits++;
      else matches.set(key, { path, line: match.line, content: match.content, hits: 1, firstQuery: queryIndex });
    }
    trace.info("pattern searched", { pattern: query.pattern, regex: query.regex, matches: found.length, inScope: kept });
  }
  options.signal.throwIfAborted();

  const ranked = rankMatches(matches);
  const { output, returned } = formatResults(options, ranked, maxResults);
  trace.info("results ranked", { uniqueMatches: matches.size, ranked: ranked.length, returned, outputBytes: output.length });
  return output;
}
