// ============================================================
// definitions/webSearch.ts — direct port of the sidecar's vendored
// pi-web-access/gemini-search.ts multi-provider waterfall (Brave, Tavily,
// Perplexity, Exa, Parallel, OpenAI, Gemini), each a plain fetch() call
// tried in order until one succeeds -- ported here rather than shared
// because the source is TypeScript loaded via jiti at sidecar runtime
// (agent-sidecar/src/services/webSearchTool.ts), not an importable module
// from this app's own build.
//
// Every provider's *config-file*/`process.env` key resolution (Node-only,
// same gap Phase 2's directExecution.ts already documented for
// resolveProviderApiKey) is replaced with keys read from this app's own
// Settings UI (WebSearchSettings.tsx / store.webSearchApiKeys) -- the one
// real design decision this port had to make, since the app had no prior
// place to store these keys at all.
//
// Deliberately NOT ported (documented gaps, consistent with every other
// cut in this plan):
//  - Gemini's cookie-authenticated gemini.google.com scraping fallback
//    (gemini-web.ts, 411 lines) -- non-portable to a signed-out browser
//    session; the Gemini API-key path is kept.
//  - OpenAI's Codex-subscription auth reuse (resolveOpenAIAuth's
//    `ctx.modelRegistry` branch) -- needs pi-ai's model registry, which
//    only exists sidecar-side; a plain user-supplied OpenAI API key works
//    the same as it does for every other provider here.
//  - Exa's `includeContent`/inline extracted-page-content mode, and every
//    provider's `inlineContent` field generally -- this tool only ever
//    returns a synthesized answer + a source list, matching what
//    agent_chat.ts's own web_search tool actually surfaces to the model.
// ============================================================

import type { TokenUsage } from "../../contract";

export type WebSearchProvider = "auto" | "openai" | "brave" | "parallel" | "tavily" | "exa" | "perplexity" | "gemini";
export type ResolvedWebSearchProvider = Exclude<WebSearchProvider, "auto">;

export type WebSearchApiKeys = Partial<Record<ResolvedWebSearchProvider, string>>;

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** What one provider call produced. Providers that answer with an LLM
 * (OpenAI, Perplexity, Gemini) also say which model ran and what it cost,
 * so the call can be attributed to that model in observability and metrics. */
interface ProviderResult {
  answer: string;
  results: WebSearchResult[];
  model?: string;
  usage?: TokenUsage;
}

export interface WebSearchResponse extends ProviderResult {
  provider: ResolvedWebSearchProvider;
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export interface WebSearchOptions {
  numResults?: number;
  recencyFilter?: "day" | "week" | "month" | "year";
  domainFilter?: string[];
  provider?: WebSearchProvider;
  signal?: AbortSignal;
}

type PlainSearchOptions = Omit<WebSearchOptions, "provider">;

// --- shared helpers -----------------------------------------------------

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isAbortError(err: unknown): boolean {
  return errorMessage(err).toLowerCase().includes("abort");
}

function requestSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function checkedResponse(provider: string, response: Response, maxErrorLength = 300): Promise<Response> {
  if (response.ok) return response;
  const errorText = await response.text();
  const detail = maxErrorLength === Infinity ? errorText : errorText.slice(0, maxErrorLength);
  throw new Error(`${provider} API error ${response.status}: ${detail}`);
}

function normalizeDomain(value: string): string | null {
  let input = value.trim().toLowerCase();
  if (!input) return null;
  if (input.startsWith("-")) input = input.slice(1).trim();
  if (!input) return null;
  try {
    const parsed = input.includes("://") ? new URL(input) : new URL(`https://${input}`);
    input = parsed.hostname;
  } catch {
    input = input.split("/")[0]?.split(":")[0] ?? "";
  }
  input = input.replace(/^\.+|\.+$/g, "");
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(input) ? input : null;
}

function splitDomainFilter(domainFilter: string[] | undefined): { include: string[]; exclude: string[] } {
  const include: string[] = [];
  const exclude: string[] = [];
  for (const raw of domainFilter ?? []) {
    const domain = normalizeDomain(raw);
    if (!domain) continue;
    const target = raw.trim().startsWith("-") ? exclude : include;
    if (!target.includes(domain)) target.push(domain);
  }
  return { include, exclude };
}

function normalizeCount(value: number | undefined, max = 20): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 5;
  return Math.max(1, Math.min(Math.floor(value), max));
}

// --- Brave ---------------------------------------------------------------

async function searchWithBrave(query: string, options: PlainSearchOptions, apiKey: string): Promise<{ answer: string; results: WebSearchResult[] }> {
  const numResults = normalizeCount(options.numResults);
  const { include, exclude } = splitDomainFilter(options.domainFilter);
  const queryParts = [query];
  if (include.length === 1) queryParts.push(`site:${include[0]}`);
  else if (include.length > 1) queryParts.push(include.map((d) => `site:${d}`).join(" OR "));
  for (const domain of exclude) queryParts.push(`NOT site:${domain}`);

  const params = new URLSearchParams({ q: queryParts.join(" "), count: String(options.domainFilter?.length ? 20 : numResults) });
  if (options.recencyFilter) {
    const freshnessMap: Record<string, string> = { day: "pd", week: "pw", month: "pm", year: "py" };
    params.set("freshness", freshnessMap[options.recencyFilter]);
  }

  const response = await checkedResponse("Brave Search", await fetch(`https://api.search.brave.com/res/v1/web/search?${params.toString()}`, {
    method: "GET",
    headers: { "X-Subscription-Token": apiKey, Accept: "application/json", "Accept-Encoding": "gzip" },
    signal: requestSignal(options.signal, 30_000),
  }));
  const data = (await response.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
  const { include: allowed, exclude: blocked } = splitDomainFilter(options.domainFilter);
  const hostMatches = (hostname: string, domain: string) => hostname === domain || hostname.endsWith(`.${domain}`);
  const matchesFilters = (url: string) => {
    if (allowed.length === 0 && blocked.length === 0) return true;
    let hostname = "";
    try {
      hostname = new URL(url).hostname.toLowerCase();
    } catch {
      return false;
    }
    if (allowed.length > 0 && !allowed.some((d) => hostMatches(hostname, d))) return false;
    return !blocked.some((d) => hostMatches(hostname, d));
  };

  const results: WebSearchResult[] = [];
  for (const item of data.web?.results ?? []) {
    if (!item.url || !matchesFilters(item.url)) continue;
    results.push({ title: item.title || item.url, url: item.url, snippet: item.description || "" });
    if (results.length >= numResults) break;
  }
  const answer = results.map((r) => (r.snippet ? `${r.snippet}\nSource: ${r.title} (${r.url})` : `Source: ${r.title} (${r.url})`)).join("\n\n");
  return { answer, results };
}

// --- Tavily ----------------------------------------------------------------

async function searchWithTavily(query: string, options: PlainSearchOptions, apiKey: string): Promise<{ answer: string; results: WebSearchResult[] }> {
  const numResults = normalizeCount(options.numResults);
  const { include, exclude } = splitDomainFilter(options.domainFilter);
  const body: Record<string, unknown> = {
    query,
    search_depth: "basic",
    max_results: numResults,
    include_answer: "basic",
    include_raw_content: false,
    ...(options.recencyFilter ? { time_range: options.recencyFilter } : {}),
    ...(include.length ? { include_domains: include } : {}),
    ...(exclude.length ? { exclude_domains: exclude } : {}),
  };
  const response = await checkedResponse("Tavily", await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: requestSignal(options.signal, 60_000),
  }));
  const data = (await response.json()) as { answer?: string; results?: Array<{ title?: string; url?: string; content?: string }> };
  const results: WebSearchResult[] = [];
  for (const item of data.results ?? []) {
    if (!item.url) continue;
    results.push({ title: item.title || `Source ${results.length + 1}`, url: item.url, snippet: typeof item.content === "string" ? item.content.replace(/\s+/g, " ").trim() : "" });
    if (results.length >= numResults) break;
  }
  return { answer: typeof data.answer === "string" ? data.answer : "", results };
}

// --- Perplexity --------------------------------------------------------------

const PERPLEXITY_RATE_LIMIT = { maxRequests: 10, windowMs: 60_000 };
const perplexityRequestTimestamps: number[] = [];

function checkPerplexityRateLimit(): void {
  const now = Date.now();
  const windowStart = now - PERPLEXITY_RATE_LIMIT.windowMs;
  while (perplexityRequestTimestamps.length > 0 && perplexityRequestTimestamps[0] < windowStart) perplexityRequestTimestamps.shift();
  if (perplexityRequestTimestamps.length >= PERPLEXITY_RATE_LIMIT.maxRequests) {
    const waitMs = perplexityRequestTimestamps[0] + PERPLEXITY_RATE_LIMIT.windowMs - now;
    throw new Error(`Rate limited. Try again in ${Math.ceil(waitMs / 1000)}s`);
  }
  perplexityRequestTimestamps.push(now);
}

async function searchWithPerplexity(query: string, options: PlainSearchOptions, apiKey: string): Promise<ProviderResult> {
  checkPerplexityRateLimit();
  const numResults = normalizeCount(options.numResults);
  const requestBody: Record<string, unknown> = { model: "sonar", messages: [{ role: "user", content: query }], max_tokens: 1024, return_related_questions: false };
  if (options.recencyFilter) requestBody.search_recency_filter = options.recencyFilter;
  if (options.domainFilter?.length) {
    const validated = options.domainFilter.filter((d) => /^[a-zA-Z0-9][a-zA-Z0-9-_.]*\.[a-zA-Z]{2,}$/.test(d.startsWith("-") ? d.slice(1) : d));
    if (validated.length) requestBody.search_domain_filter = validated;
  }
  const response = await checkedResponse("Perplexity", await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
    signal: options.signal,
  }), Infinity);
  const data = (await response.json()) as { model?: string; usage?: unknown; choices?: Array<{ message?: { content?: string } }>; citations?: unknown[] };
  const answer = data.choices?.[0]?.message?.content || "";
  const citations = Array.isArray(data.citations) ? data.citations : [];
  const results: WebSearchResult[] = [];
  for (let i = 0; i < Math.min(citations.length, numResults); i++) {
    const citation = citations[i];
    if (typeof citation === "string") results.push({ title: `Source ${i + 1}`, url: citation, snippet: "" });
    else if (citation && typeof citation === "object" && typeof (citation as { url?: unknown }).url === "string") {
      const c = citation as { url: string; title?: string };
      results.push({ title: c.title || `Source ${i + 1}`, url: c.url, snippet: "" });
    }
  }
  const usage = record(data.usage);
  return {
    answer,
    results,
    model: data.model || "sonar",
    usage: {
      input: tokenCount(usage.prompt_tokens),
      output: tokenCount(usage.completion_tokens),
      totalTokens: tokenCount(usage.total_tokens),
      ...(tokenCount(usage.reasoning_tokens) !== undefined ? { reasoning: tokenCount(usage.reasoning_tokens) } : {}),
    },
  };
}

// --- Gemini (API-key path only -- see module doc for the dropped fallback) ---

async function searchWithGemini(query: string, options: PlainSearchOptions, apiKey: string): Promise<ProviderResult | null> {
  const body = { contents: [{ role: "user", parts: [{ text: query }] }], tools: [{ google_search: {} }] };
  const response = await checkedResponse("Gemini", await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: requestSignal(options.signal, 60_000),
  }));
  const data = (await response.json()) as {
    modelVersion?: string;
    usageMetadata?: unknown;
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> };
    }>;
  };
  const answer = data.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("\n") ?? "";
  const results: WebSearchResult[] = (data.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [])
    .filter((chunk): chunk is { web: { uri?: string; title?: string } } => !!chunk.web?.uri)
    .map((chunk) => ({ title: chunk.web.title || "", url: chunk.web.uri!, snippet: "" }));
  if (!answer && results.length === 0) return null;
  const usage = record(data.usageMetadata);
  return {
    answer,
    results,
    model: data.modelVersion || "gemini-3-flash-preview",
    usage: {
      input: tokenCount(usage.promptTokenCount),
      output: tokenCount(usage.candidatesTokenCount),
      cacheRead: tokenCount(usage.cachedContentTokenCount),
      totalTokens: tokenCount(usage.totalTokenCount),
      ...(tokenCount(usage.thoughtsTokenCount) !== undefined ? { reasoning: tokenCount(usage.thoughtsTokenCount) } : {}),
    },
  };
}

// --- Exa (with key: Answer/Search APIs; no key: public MCP endpoint) -------

async function searchWithExaKeyed(query: string, options: PlainSearchOptions, apiKey: string): Promise<{ answer: string; results: WebSearchResult[] }> {
  const useSearch = !!options.recencyFilter || !!options.domainFilter?.length || !!(options.numResults && options.numResults !== 5);
  if (!useSearch) {
    const response = await checkedResponse("Exa", await fetch("https://api.exa.ai/answer", {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ query, text: true }),
      signal: requestSignal(options.signal, 60_000),
    }));
    const data = (await response.json()) as { answer?: string; citations?: Array<{ url?: string; title?: string }> };
    const results: WebSearchResult[] = (data.citations ?? []).filter((c): c is { url: string; title?: string } => !!c.url).map((c, i) => ({ title: c.title || `Source ${i + 1}`, url: c.url, snippet: "" }));
    return { answer: data.answer || "", results };
  }

  const { include, exclude } = splitDomainFilter(options.domainFilter);
  const recencyToStartDate = (filter: string) => {
    const offsets: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 };
    return new Date(Date.now() - (offsets[filter] ?? 0) * 86_400_000).toISOString();
  };
  const response = await checkedResponse("Exa", await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      type: "auto",
      numResults: options.numResults ?? 5,
      ...(include.length ? { includeDomains: include } : {}),
      ...(exclude.length ? { excludeDomains: exclude } : {}),
      ...(options.recencyFilter ? { startPublishedDate: recencyToStartDate(options.recencyFilter) } : {}),
      contents: { text: { maxCharacters: 3000 }, highlights: true },
    }),
    signal: requestSignal(options.signal, 60_000),
  }));
  const data = (await response.json()) as { results?: Array<{ title?: string; url?: string; text?: string; highlights?: unknown }> };
  const items = data.results ?? [];
  const results: WebSearchResult[] = items.filter((item): item is { url: string; title?: string } => !!item.url).map((item, i) => ({ title: item.title || `Source ${i + 1}`, url: item.url, snippet: "" }));
  const answerParts: string[] = [];
  items.forEach((item, i) => {
    if (!item.url) return;
    const highlights = Array.isArray(item.highlights) ? item.highlights.filter((h): h is string => typeof h === "string") : [];
    const content = highlights.length > 0 ? highlights.join(" ") : typeof item.text === "string" ? item.text.trim().slice(0, 1000) : "";
    if (content) answerParts.push(`${content}\nSource: ${item.title || `Source ${i + 1}`} (${item.url})`);
  });
  return { answer: answerParts.join("\n\n"), results };
}

type ExaMcpResponse = {
  result?: { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
  error?: { code?: number; message?: string };
};

function exaMcpQuery(query: string, options: PlainSearchOptions): string {
  const queryParts = [query];
  for (const domain of options.domainFilter ?? []) queryParts.push(domain.startsWith("-") ? `-site:${domain.slice(1)}` : `site:${domain}`);
  if (options.recencyFilter) {
    const now = new Date();
    const labels: Record<string, string> = { day: "past 24 hours", week: "past week", month: `${now.toLocaleString("en", { month: "long" })} ${now.getFullYear()}`, year: String(now.getFullYear()) };
    queryParts.push(labels[options.recencyFilter]);
  }
  return queryParts.join(" ");
}

async function fetchExaMcp(query: string, options: PlainSearchOptions): Promise<string> {
  const response = await checkedResponse("Exa MCP", await fetch("https://mcp.exa.ai/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "web_search_exa", arguments: { query, numResults: options.numResults ?? 5, livecrawl: "fallback", type: "auto", contextMaxCharacters: 3000 } },
    }),
    signal: requestSignal(options.signal, 60_000),
  }));
  return response.text();
}

function parseExaMcpJson(text: string): ExaMcpResponse | null {
  try {
    return JSON.parse(text) as ExaMcpResponse;
  } catch {
    return null;
  }
}

function parseExaMcpEventStream(bodyText: string): ExaMcpResponse | null {
  for (const line of bodyText.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const candidate = parseExaMcpJson(line.slice(5).trim());
    if (candidate?.result || candidate?.error) return candidate;
  }
  return null;
}

function parseExaMcpResponse(bodyText: string): string {
  const parsed = parseExaMcpEventStream(bodyText) ?? parseExaMcpJson(bodyText);
  if (!parsed) throw new Error("Exa MCP returned an empty response");
  if (parsed.error) throw new Error(`Exa MCP error${parsed.error.code ? ` ${parsed.error.code}` : ""}: ${parsed.error.message || "Unknown error"}`);
  if (parsed.result?.isError) throw new Error(parsed.result.content?.find((content) => content.type === "text")?.text?.trim() || "Exa MCP returned an error");
  const text = parsed.result?.content?.find((content) => content.type === "text" && content.text?.trim())?.text;
  if (!text) throw new Error("Exa MCP returned empty content");
  return text;
}

type ExaMcpResult = { title: string; url: string; content: string };

function parseExaMcpBlocks(text: string): ExaMcpResult[] {
  const blocks = text.split(/(?=^Title: )/m).filter((block) => block.trim());
  return blocks.map((block) => {
    const title = block.match(/^Title: (.+)/m)?.[1]?.trim() ?? "";
    const url = block.match(/^URL: (.+)/m)?.[1]?.trim() ?? "";
    const textStart = block.indexOf("\nText: ");
    let content = textStart >= 0 ? block.slice(textStart + 7).trim() : "";
    if (!content) {
      const highlights = block.match(/\nHighlights:\s*\n/);
      if (highlights?.index != null) content = block.slice(highlights.index + highlights[0].length).trim();
    }
    return { title, url, content: content.replace(/\n---\s*$/, "").trim() };
  }).filter((result) => result.url.length > 0);
}

function formatExaMcpResults(results: ExaMcpResult[]): { answer: string; results: WebSearchResult[] } | null {
  if (results.length === 0) return null;
  const answer = results.map((result, index) => {
    const snippet = result.content.replace(/\s+/g, " ").trim().slice(0, 500);
    return snippet ? `${snippet}\nSource: ${result.title || `Source ${index + 1}`} (${result.url})` : "";
  }).filter(Boolean).join("\n\n");
  return { answer, results: results.map((result, index) => ({ title: result.title || `Source ${index + 1}`, url: result.url, snippet: "" })) };
}

async function searchWithExaMcp(query: string, options: PlainSearchOptions): Promise<{ answer: string; results: WebSearchResult[] } | null> {
  const requestQuery = exaMcpQuery(query, options);
  const responseText = await fetchExaMcp(requestQuery, options);
  return formatExaMcpResults(parseExaMcpBlocks(parseExaMcpResponse(responseText)));
}

async function searchWithExa(query: string, options: PlainSearchOptions, apiKey: string | undefined): Promise<{ answer: string; results: WebSearchResult[] } | null> {
  if (apiKey) return searchWithExaKeyed(query, options, apiKey);
  return searchWithExaMcp(query, options);
}

// --- Parallel ----------------------------------------------------------------

async function parallelFetch(url: string, body: Record<string, unknown>, apiKey: string, signal: AbortSignal | undefined): Promise<Record<string, unknown>> {
  const response = await checkedResponse("Parallel", await fetch(url, {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: requestSignal(signal, 60_000),
  }));
  return (await response.json()) as Record<string, unknown>;
}

async function searchWithParallel(query: string, options: PlainSearchOptions, apiKey: string): Promise<{ answer: string; results: WebSearchResult[] }> {
  const numResults = normalizeCount(options.numResults);
  const { include, exclude } = splitDomainFilter(options.domainFilter);
  const recencyToAfterDate = (filter: string) => {
    const offsets: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 };
    return new Date(Date.now() - (offsets[filter] ?? 0) * 86_400_000).toISOString().slice(0, 10);
  };
  const sourcePolicy = { ...(include.length ? { include_domains: include } : {}), ...(exclude.length ? { exclude_domains: exclude } : {}), ...(options.recencyFilter ? { after_date: recencyToAfterDate(options.recencyFilter) } : {}) };
  const body = { objective: query, search_queries: [query], advanced_settings: { max_results: numResults, ...(Object.keys(sourcePolicy).length ? { source_policy: sourcePolicy } : {}) } };
  const data = await parallelFetch("https://api.parallel.ai/v1/search", body, apiKey, options.signal);
  const items = (data.results ?? []) as Array<{ url?: string; title?: string; excerpts?: unknown }>;
  const normalizeExcerpts = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0) : []);
  const results: WebSearchResult[] = [];
  const answerParts: string[] = [];
  items.forEach((item, i) => {
    if (!item.url) return;
    const excerpts = normalizeExcerpts(item.excerpts);
    results.push({ title: item.title || `Source ${i + 1}`, url: item.url, snippet: excerpts[0]?.replace(/\s+/g, " ").trim().slice(0, 200) || "" });
    if (excerpts.length) answerParts.push(`${excerpts.join(" ")}\nSource: ${item.title || `Source ${i + 1}`} (${item.url})`);
  });
  return { answer: answerParts.join("\n\n"), results };
}

// --- OpenAI (plain API key only -- see module doc for the dropped Codex-ctx branch) ---

function firstPresent(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

function cleanOpenAIUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.get("utm_source") === "openai") parsed.searchParams.delete("utm_source");
    return parsed.toString();
  } catch {
    return url;
  }
}

function addOpenAIResult(
  results: WebSearchResult[],
  seenUrls: Set<string>,
  url: unknown,
  title: unknown,
  snippet = "",
) {
  if (typeof url !== "string" || !url.trim()) return;
  const cleanUrl = cleanOpenAIUrl(url);
  if (seenUrls.has(cleanUrl)) return;
  seenUrls.add(cleanUrl);
  results.push({ title: typeof title === "string" && title.trim() ? title : cleanUrl, url: cleanUrl, snippet });
}

function readOpenAIEvent(data: string): { item?: unknown; response?: Record<string, unknown> } | null {
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    const item = parsed.type === "response.output_item.done" ? parsed.item : undefined;
    const isResponseEvent = parsed.type === "response.done" || parsed.type === "response.completed";
    const response = isResponseEvent && parsed.response && typeof parsed.response === "object"
      ? parsed.response as Record<string, unknown>
      : undefined;
    return { item, response };
  } catch {
    // Ignore non-JSON SSE lines, matching the tolerant provider parser.
    return null;
  }
}

function readOpenAIEvents(text: string): { output: unknown[]; response: Record<string, unknown> | null } {
  const outputItems: unknown[] = [];
  let completedResponse: Record<string, unknown> | null = null;
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    if (!data || data === "[DONE]") continue;
    const event = readOpenAIEvent(data);
    if (!event) continue;
    if (event.item) outputItems.push(event.item);
    if (event.response) completedResponse = event.response;
  }
  const output = completedResponse
    ? (Array.isArray(completedResponse.output) ? completedResponse.output : outputItems)
    : outputItems;
  return { output, response: completedResponse };
}

function isRecordArray(value: unknown): value is Array<Record<string, unknown>> {
  return Array.isArray(value);
}

function appendOpenAIMessage(item: Record<string, unknown>, answerParts: string[], results: WebSearchResult[], seenUrls: Set<string>) {
  if (!isRecordArray(item.content)) return;
  for (const part of item.content) {
    if (typeof part.text === "string" && part.text.trim()) answerParts.push(part.text);
    if (!isRecordArray(part.annotations)) continue;
    for (const annotation of part.annotations) {
      if (annotation.type === "url_citation") addOpenAIResult(results, seenUrls, annotation.url, annotation.title);
    }
  }
}

function appendOpenAISearchSources(item: Record<string, unknown>, results: WebSearchResult[], seenUrls: Set<string>) {
  if (item.type !== "web_search_call") return;
  const action = item.action as { sources?: unknown } | undefined;
  for (const group of [action?.sources, item.sources, item.results]) {
    if (!isRecordArray(group)) continue;
    for (const source of group) {
      addOpenAIResult(results, seenUrls, firstPresent(source.url, source.source_website_url), firstPresent(source.title, source.caption));
    }
  }
}

function readOpenAIAnswerAndCitations(output: unknown[]): { answer: string; results: WebSearchResult[] } {
  const answerParts: string[] = [];
  const results: WebSearchResult[] = [];
  const seenUrls = new Set<string>();
  const items = output as Array<Record<string, unknown>>;
  for (const item of items) {
    if (item?.type === "message") appendOpenAIMessage(item, answerParts, results, seenUrls);
  }
  for (const item of items) appendOpenAISearchSources(item, results, seenUrls);
  return { answer: answerParts.join("\n").trim(), results };
}

function limitOpenAIResults(results: WebSearchResult[], requested: number | undefined): WebSearchResult[] {
  return typeof requested === "number" && Number.isFinite(requested) && requested > 0
    ? results.slice(0, Math.min(Math.floor(requested), 20))
    : results;
}

function openAIUsage(response: Record<string, unknown> | null): TokenUsage {
  const usage = record(response?.usage);
  const reasoning = tokenCount(record(usage.output_tokens_details).reasoning_tokens);
  return {
    input: tokenCount(usage.input_tokens),
    output: tokenCount(usage.output_tokens),
    cacheRead: tokenCount(record(usage.input_tokens_details).cached_tokens),
    totalTokens: tokenCount(usage.total_tokens),
    ...(reasoning !== undefined ? { reasoning } : {}),
  };
}

async function searchWithOpenAI(query: string, options: PlainSearchOptions, apiKey: string): Promise<ProviderResult> {
  const { include, exclude } = splitDomainFilter(options.domainFilter);
  const instructionLines = ["Search the web and return a concise answer grounded only in the web results.", "Include clickable source citations in the response text when possible."];
  if (options.recencyFilter) {
    const labels: Record<string, string> = { day: "past 24 hours", week: "past week", month: "past month", year: "past year" };
    instructionLines.push(`Prefer sources from the ${labels[options.recencyFilter]}.`);
  }
  if (include.length) instructionLines.push(`Only use sources from: ${include.join(", ")}.`);
  if (exclude.length) instructionLines.push(`Do not use sources from: ${exclude.join(", ")}.`);

  const tool: Record<string, unknown> = { type: "web_search" };
  if (include.length || exclude.length) tool.filters = { ...(include.length ? { allowed_domains: include } : {}), ...(exclude.length ? { blocked_domains: exclude } : {}) };

  const response = await checkedResponse("OpenAI", await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "OpenAI-Beta": "responses=experimental" },
    body: JSON.stringify({
      model: "gpt-5.4",
      instructions: instructionLines.join(" "),
      input: [{ role: "user", content: [{ type: "input_text", text: query }] }],
      tools: [tool],
      include: ["web_search_call.action.sources"],
      store: false,
      stream: true,
      tool_choice: "required",
      parallel_tool_calls: true,
    }),
    signal: requestSignal(options.signal, 60_000),
  }));

  const text = await response.text();
  const { output, response: completedResponse } = readOpenAIEvents(text);
  if (output.length === 0) throw new Error("OpenAI API returned no parseable response output");

  const { answer, results } = readOpenAIAnswerAndCitations(output);
  const limitedResults = limitOpenAIResults(results, options.numResults);
  if (!answer && limitedResults.length === 0) throw new Error("OpenAI web_search returned no answer or sources");
  return {
    answer,
    results: limitedResults,
    model: typeof completedResponse?.model === "string" ? completedResponse.model : "gpt-5.4",
    usage: openAIUsage(completedResponse),
  };
}

// --- master dispatch ------------------------------------------------------

function shouldTryOpenAIInAuto(options: PlainSearchOptions): boolean {
  if (options.recencyFilter) return false;
  if (typeof options.numResults === "number" && Number.isFinite(options.numResults) && Math.floor(options.numResults) !== 5) return false;
  return true;
}

const PROVIDER_LABELS: Record<ResolvedWebSearchProvider, string> = {
  openai: "OpenAI",
  exa: "Exa",
  brave: "Brave",
  parallel: "Parallel",
  tavily: "Tavily",
  perplexity: "Perplexity",
  gemini: "Gemini",
};

const MISSING_PROVIDER_KEY_ERRORS: Partial<Record<ResolvedWebSearchProvider, string>> = {
  openai: "OpenAI web search unavailable: no OpenAI API key configured in Settings > Web Search.",
  brave: "Brave Search unavailable: no Brave API key configured in Settings > Web Search.",
  parallel: "Parallel search unavailable: no Parallel API key configured in Settings > Web Search.",
  tavily: "Tavily search unavailable: no Tavily API key configured in Settings > Web Search.",
  perplexity: "Perplexity search unavailable: no Perplexity API key configured in Settings > Web Search.",
  gemini: "Gemini search unavailable: no Gemini API key configured in Settings > Web Search.",
};

type SearchAttempt = {
  provider: ResolvedWebSearchProvider;
  available: boolean;
  run: () => Promise<ProviderResult | null>;
};

async function runExplicitProvider(
  provider: Exclude<WebSearchProvider, "auto">,
  query: string,
  options: PlainSearchOptions,
  apiKeys: WebSearchApiKeys,
): Promise<WebSearchResponse> {
  const key = apiKeys[provider];
  const missingKeyMessage = MISSING_PROVIDER_KEY_ERRORS[provider];
  if (missingKeyMessage && !key) throw new Error(missingKeyMessage);
  const attempt: SearchAttempt = {
    provider,
    available: true,
    run: () => {
      switch (provider) {
        case "openai": return searchWithOpenAI(query, options, key!);
        case "brave": return searchWithBrave(query, options, key!);
        case "parallel": return searchWithParallel(query, options, key!);
        case "tavily": return searchWithTavily(query, options, key!);
        case "perplexity": return searchWithPerplexity(query, options, key!);
        case "gemini": return searchWithGemini(query, options, key!);
        case "exa": return searchWithExa(query, options, key);
      }
    },
  };
  const result = await attempt.run();
  if (!result && provider === "exa") return { answer: "", results: [], provider: "exa" };
  if (!result) throw new Error("Gemini search returned no answer or sources.");
  return { ...result, provider };
}

const AUTO_PROVIDER_ORDER: readonly ResolvedWebSearchProvider[] = ["openai", "exa", "brave", "parallel", "tavily", "perplexity", "gemini"];

function buildAutoAttempts(query: string, options: PlainSearchOptions, apiKeys: WebSearchApiKeys): SearchAttempt[] {
  const attempts: Record<ResolvedWebSearchProvider, SearchAttempt> = {
    openai: { provider: "openai", available: !!apiKeys.openai && shouldTryOpenAIInAuto(options), run: () => searchWithOpenAI(query, options, apiKeys.openai!) },
    exa: { provider: "exa", available: true, run: () => searchWithExa(query, options, apiKeys.exa) },
    brave: { provider: "brave", available: !!apiKeys.brave, run: () => searchWithBrave(query, options, apiKeys.brave!) },
    parallel: { provider: "parallel", available: !!apiKeys.parallel, run: () => searchWithParallel(query, options, apiKeys.parallel!) },
    tavily: { provider: "tavily", available: !!apiKeys.tavily, run: () => searchWithTavily(query, options, apiKeys.tavily!) },
    perplexity: { provider: "perplexity", available: !!apiKeys.perplexity, run: () => searchWithPerplexity(query, options, apiKeys.perplexity!) },
    gemini: { provider: "gemini", available: !!apiKeys.gemini, run: () => searchWithGemini(query, options, apiKeys.gemini!) },
  };
  return AUTO_PROVIDER_ORDER.map((provider) => attempts[provider]);
}

async function runAutoProvider(query: string, options: PlainSearchOptions, apiKeys: WebSearchApiKeys): Promise<WebSearchResponse> {
  const errors: string[] = [];
  for (const attempt of buildAutoAttempts(query, options, apiKeys)) {
    if (!attempt.available) continue;
    try {
      const result = await attempt.run();
      if (result) return { ...result, provider: attempt.provider };
    } catch (err) {
      if (isAbortError(err)) throw err;
      errors.push(`${PROVIDER_LABELS[attempt.provider]}: ${errorMessage(err)}`);
    }
  }
  throw new Error(`Web search failed:\n  - ${errors.join("\n  - ")}`);
}

/** Direct port of gemini-search.ts's own `search()` waterfall -- see the
 * module doc for what got dropped. Throws only when every attempted
 * provider fails (or none is configured); a caller-selected `provider`
 * (not "auto") throws immediately if that one provider has no key
 * (Exa excepted -- it always has its no-key MCP fallback). */
export async function runWebSearch(query: string, options: WebSearchOptions, apiKeys: WebSearchApiKeys): Promise<WebSearchResponse> {
  const provider = options.provider ?? "auto";
  const plain: PlainSearchOptions = { numResults: options.numResults, recencyFilter: options.recencyFilter, domainFilter: options.domainFilter, signal: options.signal };
  return provider === "auto"
    ? runAutoProvider(query, plain, apiKeys)
    : runExplicitProvider(provider, query, plain, apiKeys);
}
