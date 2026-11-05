// ============================================================
// definitions/rustyDocsTool.ts -- "rusty_docs": Rusty's own documentation, read-only.
//
// Answers how Rusty works and where a setting lives from the documentation
// shipped with this build, so it describes the version the user has, needs no
// network and costs no web permission. The sections come from
// scripts/generate-docs-index.mjs. A search ends with the list of pages, because
// the docs and the user do not always use the same word; with no input the tool
// returns the full outline. It changes nothing, so every skill has it; workflow
// steps do not, since their schemas are sent with each call.
// ============================================================

import type { HostToolHandler } from "../CoreHarness";
import type { HostToolSpec } from "../SessionRecipe";
import { buildDocsSearch, type DocHit, type DocPage, type DocSection, type DocsSearch } from "../rustyDocs/search";

const DOCS_SITE = "https://rusty-edit.dev";
const SEARCH_RESULTS = 4;
/** A section longer than this is cut, and the note says how to read the rest. */
const MAX_SECTION_CHARS = 6000;

export const RUSTY_DOCS_TOOL: HostToolSpec = {
  name: "rusty_docs",
  description:
    "Search Rusty's own documentation, the version shipped with this app: what a feature is and why it exists, how it works, and where to enable or configure it (for example spec-driven development, goals, the JEV decision model, workflows, skills, settings). Use it for any question about Rusty itself, not for the user's project. query is the question in plain words and returns the best sections with their links, then the list of pages. page is a page id from that list and returns the whole page, for when the sections are not enough. With no input it returns every page's summary and headings. Read-only.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "The question, in plain words." },
      page: { type: "string", description: "A page id, to read the whole page." },
    },
    required: [],
  },
};

/** The line the system prompts show for the tool. */
export const RUSTY_DOCS_GUIDE =
  "- 'rusty_docs': Search Rusty's own documentation (input: {\"query\": \"the question\"} | {\"page\": \"page id\"}). When the user asks about Rusty itself (what a feature is, how it works, where to enable something), answer from this instead of from memory: give the steps, with the setting's exact name and location, and link the page you used. If the documentation does not cover it, say so.";

function pageUrl(page: DocPage, section?: DocSection): string {
  return `${DOCS_SITE}/docs/${page.id}/${section?.anchor ? `#${section.anchor}` : ""}`;
}

function sectionTitle(page: DocPage, section: DocSection): string {
  return section.heading ? `${page.title} > ${section.heading}` : page.title;
}

function hitText({ page, section }: DocHit): string {
  const cut = section.text.length > MAX_SECTION_CHARS;
  const text = cut ? `${section.text.slice(0, MAX_SECTION_CHARS)}\n\n[Section cut. Read the rest with {"page": "${page.id}"}.]` : section.text;
  return `## ${sectionTitle(page, section)}\n${pageUrl(page, section)}\n\n${text}`;
}

function pageList(pages: DocPage[]): string {
  return `All pages (read one with {"page": "<id>"}):\n${pages.map((page) => `- ${page.id}: ${page.title}`).join("\n")}`;
}

function outline(pages: DocPage[]): string {
  return pages
    .map((page) => {
      const headings = page.sections.map((section) => section.heading).filter(Boolean);
      return `- ${page.id}: ${page.title}. ${page.summary}${headings.length ? `\n  Sections: ${headings.join("; ")}` : ""}`;
    })
    .join("\n");
}

function wholePage(page: DocPage): string {
  const body = page.sections.map((section) => (section.heading ? `## ${section.heading}\n\n${section.text}` : section.text)).join("\n\n");
  return `# ${page.title}\n${pageUrl(page)}\n\n${body}`;
}

/** A page id, or the page's link the way a search result shows it. */
function pageId(value: string): string {
  return value.trim().replace(/^.*\/docs\//, "").replace(/[/#].*$/, "");
}

export interface RustyDocs {
  pages: DocPage[];
  search: DocsSearch;
}

/** The index is the size of the documentation, so the app loads it on the first question. */
async function loadDocs(): Promise<RustyDocs> {
  const { default: pages } = await import("../rustyDocs/docsIndex.json");
  return { pages, search: buildDocsSearch(pages) };
}

let shipped: Promise<RustyDocs> | undefined;

export function rustyDocsTool(load: () => Promise<RustyDocs> = () => (shipped ??= loadDocs())): HostToolHandler {
  return async (args) => {
    const input = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
    const query = typeof input.query === "string" ? input.query.trim() : "";
    const requestedPage = typeof input.page === "string" ? pageId(input.page) : "";
    const { pages, search } = await load();

    if (requestedPage) {
      const page = pages.find((candidate) => candidate.id === requestedPage);
      return page ? { ok: true, output: wholePage(page) } : { ok: false, error: `No documentation page "${requestedPage}".\n\n${pageList(pages)}` };
    }
    if (!query) return { ok: true, output: outline(pages) };
    const hits = search(query, SEARCH_RESULTS);
    const found = hits.length ? hits.map(hitText).join("\n\n") : `No section matches "${query}".`;
    return { ok: true, output: `${found}\n\n${pageList(pages)}` };
  };
}
