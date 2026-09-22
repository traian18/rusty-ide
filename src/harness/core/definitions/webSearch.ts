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

export type WebSearchProvider = "auto" | "openai" | "brave" | "parallel" | "tavily" | "exa" | "perplexity" | "gemini";
export type ResolvedWebSearchProvider = Exclude<WebSearchProvider, "auto">;

export type WebSearchApiKeys = Partial<Record<ResolvedWebSearchProvider, string>>;

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResponse {
  provider: ResolvedWebSearchProvider;
  answer: string;
  results: WebSearchResult[];
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

  const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params.toString()}`, {
    method: "GET",
    headers: { "X-Subscription-Token": apiKey, Accept: "application/json", "Accept-Encoding": "gzip" },
    signal: requestSignal(options.signal, 30_000),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Brave Search API error ${response.status}: ${errorText.slice(0, 300)}`);
  }
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
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: requestSignal(options.signal, 60_000),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Tavily API error ${response.status}: ${errorText.slice(0, 300)}`);
  }
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

async function searchWithPerplexity(query: string, options: PlainSearchOptions, apiKey: string): Promise<{ answer: string; results: WebSearchResult[] }> {
  checkPerplexityRateLimit();
  const numResults = normalizeCount(options.numResults);
  const requestBody: Record<string, unknown> = { model: "sonar", messages: [{ role: "user", content: query }], max_tokens: 1024, return_related_questions: false };
  if (options.recencyFilter) requestBody.search_recency_filter = options.recencyFilter;
  if (options.domainFilter?.length) {
    const validated = options.domainFilter.filter((d) => /^[a-zA-Z0-9][a-zA-Z0-9-_.]*\.[a-zA-Z]{2,}$/.test(d.startsWith("-") ? d.slice(1) : d));
    if (validated.length) requestBody.search_domain_filter = validated;
  }
  const response = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
    signal: options.signal,
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Perplexity API error ${response.status}: ${errorText}`);
  }
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }>; citations?: unknown[] };
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
  return { answer, results };
}

// --- Gemini (API-key path only -- see module doc for the dropped fallback) ---

async function searchWithGemini(query: string, options: PlainSearchOptions, apiKey: string): Promise<{ answer: string; results: WebSearchResult[] } | null> {
  const body = { contents: [{ role: "user", parts: [{ text: query }] }], tools: [{ google_search: {} }] };
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: requestSignal(options.signal, 60_000),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errorText.slice(0, 300)}`);
  }
  const data = (await response.json()) as {
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
  return { answer, results };
}

// --- Exa (with key: Answer/Search APIs; no key: public MCP endpoint) -------

async function searchWithExaKeyed(query: string, options: PlainSearchOptions, apiKey: string): Promise<{ answer: string; results: WebSearchResult[] }> {
  const useSearch = !!options.recencyFilter || !!options.domainFilter?.length || !!(options.numResults && options.numResults !== 5);
  if (!useSearch) {
    const response = await fetch("https://api.exa.ai/answer", {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ query, text: true }),
      signal: requestSignal(options.signal, 60_000),
    });
    if (!response.ok) throw new Error(`Exa API error ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const data = (await response.json()) as { answer?: string; citations?: Array<{ url?: string; title?: string }> };
    const results: WebSearchResult[] = (data.citations ?? []).filter((c): c is { url: string; title?: string } => !!c.url).map((c, i) => ({ title: c.title || `Source ${i + 1}`, url: c.url, snippet: "" }));
    return { answer: data.answer || "", results };
  }

  const { include, exclude } = splitDomainFilter(options.domainFilter);
  const recencyToStartDate = (filter: string) => {
    const offsets: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 };
    return new Date(Date.now() - (offsets[filter] ?? 0) * 86_400_000).toISOString();
  };
  const response = await fetch("https://api.exa.ai/search", {
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
  });
  if (!response.ok) throw new Error(`Exa API error ${response.status}: ${(await response.text()).slice(0, 300)}`);
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

async function searchWithExaMcp(query: string, options: PlainSearchOptions): Promise<{ answer: string; results: WebSearchResult[] } | null> {
  const queryParts = [query];
  for (const d of options.domainFilter ?? []) queryParts.push(d.startsWith("-") ? `-site:${d.slice(1)}` : `site:${d}`);
  if (options.recencyFilter) {
    const now = new Date();
    const labels: Record<string, string> = { day: "past 24 hours", week: "past week", month: `${now.toLocaleString("en", { month: "long" })} ${now.getFullYear()}`, year: String(now.getFullYear()) };
    queryParts.push(labels[options.recencyFilter]);
  }
  const response = await fetch("https://mcp.exa.ai/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "web_search_exa", arguments: { query: queryParts.join(" "), numResults: options.numResults ?? 5, livecrawl: "fallback", type: "auto", contextMaxCharacters: 3000 } },
    }),
    signal: requestSignal(options.signal, 60_000),
  });
  if (!response.ok) throw new Error(`Exa MCP error ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const bodyText = await response.text();
  let parsed: { result?: { content?: Array<{ type?: string; text?: string }>; isError?: boolean }; error?: { code?: number; message?: string } } | null = null;
  for (const line of bodyText.split("\n").filter((l) => l.startsWith("data:"))) {
    try {
      const candidate = JSON.parse(line.slice(5).trim());
      if (candidate?.result || candidate?.error) {
        parsed = candidate;
        break;
      }
    } catch {
      // not a JSON payload line -- ignore, matches the original's tolerant SSE scan
    }
  }
  if (!parsed) {
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      // falls through to the "no parseable response" error below
    }
  }
  if (!parsed) throw new Error("Exa MCP returned an empty response");
  if (parsed.error) throw new Error(`Exa MCP error${parsed.error.code ? ` ${parsed.error.code}` : ""}: ${parsed.error.message || "Unknown error"}`);
  if (parsed.result?.isError) throw new Error(parsed.result.content?.find((c) => c.type === "text")?.text?.trim() || "Exa MCP returned an error");
  const text = parsed.result?.content?.find((c) => c.type === "text" && c.text?.trim())?.text;
  if (!text) throw new Error("Exa MCP returned empty content");

  const blocks = text.split(/(?=^Title: )/m).filter((b) => b.trim());
  const parsedResults = blocks
    .map((block) => {
      const title = block.match(/^Title: (.+)/m)?.[1]?.trim() ?? "";
      const url = block.match(/^URL: (.+)/m)?.[1]?.trim() ?? "";
      const textStart = block.indexOf("\nText: ");
      let content = textStart >= 0 ? block.slice(textStart + 7).trim() : "";
      if (!content) {
        const hlMatch = block.match(/\nHighlights:\s*\n/);
        if (hlMatch?.index != null) content = block.slice(hlMatch.index + hlMatch[0].length).trim();
      }
      return { title, url, content: content.replace(/\n---\s*$/, "").trim() };
    })
    .filter((r) => r.url.length > 0);
  if (parsedResults.length === 0) return null;

  const answer = parsedResults
    .map((r, i) => {
      const snippet = r.content.replace(/\s+/g, " ").trim().slice(0, 500);
      return snippet ? `${snippet}\nSource: ${r.title || `Source ${i + 1}`} (${r.url})` : "";
    })
    .filter(Boolean)
    .join("\n\n");
  return { answer, results: parsedResults.map((r, i) => ({ title: r.title || `Source ${i + 1}`, url: r.url, snippet: "" })) };
}

async function searchWithExa(query: string, options: PlainSearchOptions, apiKey: string | undefined): Promise<{ answer: string; results: WebSearchResult[] } | null> {
  if (apiKey) return searchWithExaKeyed(query, options, apiKey);
  return searchWithExaMcp(query, options);
}

// --- Parallel ----------------------------------------------------------------

async function parallelFetch(url: string, body: Record<string, unknown>, apiKey: string, signal: AbortSignal | undefined): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: requestSignal(signal, 60_000),
  });
  if (!response.ok) throw new Error(`Parallel API error ${response.status}: ${(await response.text()).slice(0, 300)}`);
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

async function searchWithOpenAI(query: string, options: PlainSearchOptions, apiKey: string): Promise<{ answer: string; results: WebSearchResult[] }> {
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

  const response = await fetch("https://api.openai.com/v1/responses", {
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
  });
  if (!response.ok) throw new Error(`OpenAI API error ${response.status}: ${(await response.text()).slice(0, 300)}`);

  const text = await response.text();
  const outputItems: unknown[] = [];
  let completedResponse: Record<string, unknown> | null = null;
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(data) as Record<string, unknown>;
      if (parsed.type === "response.output_item.done" && parsed.item) outputItems.push(parsed.item);
      if ((parsed.type === "response.done" || parsed.type === "response.completed") && parsed.response && typeof parsed.response === "object") {
        completedResponse = parsed.response as Record<string, unknown>;
      }
    } catch {
      // non-JSON SSE line -- ignore, matches the original's tolerant scan
    }
  }
  const output = completedResponse ? (Array.isArray(completedResponse.output) ? completedResponse.output : outputItems) : outputItems;
  if (output.length === 0) throw new Error("OpenAI API returned no parseable response output");

  const answerParts: string[] = [];
  const results: WebSearchResult[] = [];
  const seenUrls = new Set<string>();
  const addResult = (url: unknown, title: unknown, snippet = "") => {
    if (typeof url !== "string" || !url.trim()) return;
    let cleanUrl = url;
    try {
      const u = new URL(url);
      if (u.searchParams.get("utm_source") === "openai") u.searchParams.delete("utm_source");
      cleanUrl = u.toString();
    } catch {
      // not a parseable URL -- keep as-is, matching the original's fallback
    }
    if (seenUrls.has(cleanUrl)) return;
    seenUrls.add(cleanUrl);
    results.push({ title: typeof title === "string" && title.trim() ? title : cleanUrl, url: cleanUrl, snippet });
  };

  for (const item of output as Array<Record<string, unknown>>) {
    if (item?.type !== "message") continue;
    const content = item.content;
    if (!Array.isArray(content)) continue;
    for (const part of content as Array<Record<string, unknown>>) {
      if (typeof part?.text === "string" && part.text.trim()) answerParts.push(part.text);
      const annotations = part?.annotations;
      if (!Array.isArray(annotations)) continue;
      for (const annotation of annotations as Array<Record<string, unknown>>) {
        if (annotation?.type !== "url_citation") continue;
        addResult(annotation.url, annotation.title);
      }
    }
  }
  for (const item of output as Array<Record<string, unknown>>) {
    if (item?.type !== "web_search_call") continue;
    const action = item.action as { sources?: unknown } | undefined;
    for (const group of [action?.sources, item.sources, item.results]) {
      if (!Array.isArray(group)) continue;
      for (const source of group as Array<Record<string, unknown>>) {
        addResult(source?.url ?? source?.source_website_url, source?.title ?? source?.caption);
      }
    }
  }

  const numResults = options.numResults;
  const limitedResults = typeof numResults === "number" && Number.isFinite(numResults) && numResults > 0 ? results.slice(0, Math.min(Math.floor(numResults), 20)) : results;
  const answer = answerParts.join("\n").trim();
  if (!answer && limitedResults.length === 0) throw new Error("OpenAI web_search returned no answer or sources");
  return { answer, results: limitedResults };
}

// --- master dispatch ------------------------------------------------------

function shouldTryOpenAIInAuto(options: PlainSearchOptions): boolean {
  if (options.recencyFilter) return false;
  if (typeof options.numResults === "number" && Number.isFinite(options.numResults) && Math.floor(options.numResults) !== 5) return false;
  return true;
}

/** Direct port of gemini-search.ts's own `search()` waterfall -- see the
 * module doc for what got dropped. Throws only when every attempted
 * provider fails (or none is configured); a caller-selected `provider`
 * (not "auto") throws immediately if that one provider has no key
 * (Exa excepted -- it always has its no-key MCP fallback). */
export async function runWebSearch(query: string, options: WebSearchOptions, apiKeys: WebSearchApiKeys): Promise<WebSearchResponse> {
  const provider = options.provider ?? "auto";
  const plain: PlainSearchOptions = { numResults: options.numResults, recencyFilter: options.recencyFilter, domainFilter: options.domainFilter, signal: options.signal };

  if (provider === "openai") {
    if (!apiKeys.openai) throw new Error("OpenAI web search unavailable: no OpenAI API key configured in Settings > Web Search.");
    return { ...(await searchWithOpenAI(query, plain, apiKeys.openai)), provider: "openai" };
  }
  if (provider === "brave") {
    if (!apiKeys.brave) throw new Error("Brave Search unavailable: no Brave API key configured in Settings > Web Search.");
    return { ...(await searchWithBrave(query, plain, apiKeys.brave)), provider: "brave" };
  }
  if (provider === "parallel") {
    if (!apiKeys.parallel) throw new Error("Parallel search unavailable: no Parallel API key configured in Settings > Web Search.");
    return { ...(await searchWithParallel(query, plain, apiKeys.parallel)), provider: "parallel" };
  }
  if (provider === "tavily") {
    if (!apiKeys.tavily) throw new Error("Tavily search unavailable: no Tavily API key configured in Settings > Web Search.");
    return { ...(await searchWithTavily(query, plain, apiKeys.tavily)), provider: "tavily" };
  }
  if (provider === "perplexity") {
    if (!apiKeys.perplexity) throw new Error("Perplexity search unavailable: no Perplexity API key configured in Settings > Web Search.");
    return { ...(await searchWithPerplexity(query, plain, apiKeys.perplexity)), provider: "perplexity" };
  }
  if (provider === "gemini") {
    if (!apiKeys.gemini) throw new Error("Gemini search unavailable: no Gemini API key configured in Settings > Web Search.");
    const result = await searchWithGemini(query, plain, apiKeys.gemini);
    if (result) return { ...result, provider: "gemini" };
    throw new Error("Gemini search returned no answer or sources.");
  }
  if (provider === "exa") {
    return { ...((await searchWithExa(query, plain, apiKeys.exa)) ?? { answer: "", results: [] }), provider: "exa" };
  }

  // "auto" -- same fallback order as gemini-search.ts's own auto branch.
  const fallbackErrors: string[] = [];

  if (apiKeys.openai && shouldTryOpenAIInAuto(plain)) {
    try {
      return { ...(await searchWithOpenAI(query, plain, apiKeys.openai)), provider: "openai" };
    } catch (err) {
      if (isAbortError(err)) throw err;
      fallbackErrors.push(`OpenAI: ${errorMessage(err)}`);
    }
  }

  try {
    const exaResult = await searchWithExa(query, plain, apiKeys.exa);
    if (exaResult) return { ...exaResult, provider: "exa" };
  } catch (err) {
    if (isAbortError(err)) throw err;
    fallbackErrors.push(`Exa: ${errorMessage(err)}`);
  }

  if (apiKeys.brave) {
    try {
      return { ...(await searchWithBrave(query, plain, apiKeys.brave)), provider: "brave" };
    } catch (err) {
      if (isAbortError(err)) throw err;
      fallbackErrors.push(`Brave: ${errorMessage(err)}`);
    }
  }
  if (apiKeys.parallel) {
    try {
      return { ...(await searchWithParallel(query, plain, apiKeys.parallel)), provider: "parallel" };
    } catch (err) {
      if (isAbortError(err)) throw err;
      fallbackErrors.push(`Parallel: ${errorMessage(err)}`);
    }
  }
  if (apiKeys.tavily) {
    try {
      return { ...(await searchWithTavily(query, plain, apiKeys.tavily)), provider: "tavily" };
    } catch (err) {
      if (isAbortError(err)) throw err;
      fallbackErrors.push(`Tavily: ${errorMessage(err)}`);
    }
  }
  if (apiKeys.perplexity) {
    try {
      return { ...(await searchWithPerplexity(query, plain, apiKeys.perplexity)), provider: "perplexity" };
    } catch (err) {
      if (isAbortError(err)) throw err;
      fallbackErrors.push(`Perplexity: ${errorMessage(err)}`);
    }
  }
  if (apiKeys.gemini) {
    try {
      const result = await searchWithGemini(query, plain, apiKeys.gemini);
      if (result) return { ...result, provider: "gemini" };
    } catch (err) {
      if (isAbortError(err)) throw err;
      fallbackErrors.push(`Gemini: ${errorMessage(err)}`);
    }
  }

  // Exa's no-key MCP fallback is always attempted above, unconditionally,
  // so fallbackErrors always has at least one entry by the time every
  // provider has been tried -- there is no "nothing was even attempted"
  // case left to report separately.
  throw new Error(`Web search failed:\n  - ${fallbackErrors.join("\n  - ")}`);
}
