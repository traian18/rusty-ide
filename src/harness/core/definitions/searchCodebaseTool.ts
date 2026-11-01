import type { HostToolHandler } from "../CoreHarness";
import { searchService } from "../../../features/explorer";
import { requestTerms } from "../semanticRead/plainExcerpt";

export const SEARCH_CODEBASE_TOOL = {
  name: "search_codebase",
  description: "Find files containing a search term or regex pattern. Returns matching file paths and line snippets (limited to 30 results).",
  input_schema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "The search pattern or regex to match" },
      request: { type: "string", description: "Optional behavior description; inferred evidence is appended after pattern matches." },
    },
    required: ["pattern"],
  },
} as const;

export function searchCodebaseTool(workspaceRoot: string): HostToolHandler {
  return async (args) => {
    const pattern = String((args as { pattern?: unknown } | undefined)?.pattern ?? "");
    const request = String((args as { request?: unknown } | undefined)?.request ?? "").trim();
    if (!pattern) return { ok: false, error: "search_codebase requires a 'pattern' argument." };
    let query = pattern;
    try {
      const matches = await searchService.searchProject({
        rootDir: workspaceRoot,
        query,
        matchCase: false,
        wholeWord: false,
        isRegex: true,
      });
      const contentMatches = matches.filter((match) => match.is_content_match).slice(0, 30);
      const lines = contentMatches.map((match) => {
        const provenance = match.content.toLowerCase().includes(pattern.toLowerCase()) ? "pattern match; verbatim query match" : "pattern match";
        return `${match.path}:${match.line} | ${match.content.trim().slice(0, 200)} | provenance: ${provenance}`;
      });
      if (request) {
        const terms = requestTerms(request);
        if (terms.length) {
          const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&"));
          query = `(${escaped.join("|")})`;
          const inferred = await searchService.searchProject({ rootDir: workspaceRoot, query, matchCase: false, wholeWord: false, isRegex: true });
          const existing = new Set(contentMatches.map((match) => `${match.path}:${match.line}`));
          lines.push(...inferred.filter((match) => match.is_content_match && !existing.has(`${match.path}:${match.line}`)).slice(0, Math.max(0, 30 - lines.length)).map((match) => {
            const provenance = match.content.toLowerCase().includes(request.toLowerCase()) ? "verbatim query match" : "pattern match; inferred relevance";
            return `${match.path}:${match.line} | ${match.content.trim().slice(0, 200)} | provenance: ${provenance}`;
          }));
        }
      }
      if (lines.length === 0) return { ok: true, output: "No matches found in the search performed. Try another pattern or a more specific pattern." };
      return { ok: true, output: lines.join("\n") };
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
}
