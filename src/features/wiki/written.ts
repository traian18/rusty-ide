/** Written documentation as the host returns it, and the small pure helpers the reading view needs. */
export type WrittenKind = "overview" | "getting_started" | "key_concepts" | "how_it_works" | "architecture" | "active_landscape" | "glossary" | "module" | "file";
export type PageState = "missing" | "fresh" | "stale" | "expired";
export type Freshness = "fresh" | "stale" | "expired";

export type SourceRef = { kind: "lines"; citation: { file: string; start_line: number; end_line: number; content_hash: string } } | { kind: "derived"; description: string };

export interface Source {
  n: number;
  reference: SourceRef;
  excerpt: string;
}

export interface WrittenPage {
  id: string;
  kind: WrittenKind;
  title: string;
  markdown: string;
  footnotes: Source[];
  diagrams: string[];
  facts_digest: string;
  author: { model: string; style: string; written_at_ms: number; commit: string | null };
  dropped: number;
  needs_review: boolean;
}

export interface DiagramView {
  key: string;
  title: string;
  svg: string;
}

export interface WrittenView {
  page: WrittenPage;
  freshness: Freshness;
  diagrams: DiagramView[];
}

export interface PlannedPage {
  id: string;
  kind: string;
  title: string;
  files: number;
  inputTokens: number;
  state: PageState;
}

export interface DocumentationSettings {
  model: string | null;
  style: string | null;
}

export interface DocumentationPlan {
  pages: PlannedPage[];
  inputTokens: number;
  settings: DocumentationSettings;
}

export interface BriefView {
  id: string;
  title: string;
  system: string;
  prompt: string;
  inputChars: number;
  style: string;
  /** A page built without a model (the glossary): saved as it is. */
  prewritten: string | null;
}

export type Segment = { type: "markdown"; text: string } | { type: "diagram"; key: string };

const DIAGRAM_LINE = /^@@diagram:([A-Za-z0-9_-]+)@@\s*$/;

/** Splits a page at its diagram markers, which sit on lines of their own. */
export function splitDiagrams(markdown: string): Segment[] {
  const segments: Segment[] = [];
  let text: string[] = [];
  const flush = () => {
    const joined = text.join("\n").trim();
    if (joined) segments.push({ type: "markdown", text: joined });
    text = [];
  };
  for (const line of markdown.split("\n")) {
    const marker = DIAGRAM_LINE.exec(line);
    if (marker) {
      flush();
      segments.push({ type: "diagram", key: marker[1] });
    } else {
      text.push(line);
    }
  }
  flush();
  return segments;
}

/** Turns backticked file paths the page names into links (`#file:path`), leaving code blocks and other code alone. */
export function linkPaths(markdown: string, paths: readonly string[]): string {
  const known = new Set(paths);
  let fenced = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) fenced = !fenced;
      if (fenced) return line;
      return line.replace(/(\[)?`([^`\s]+)`/g, (whole, bracket: string | undefined, token: string) => {
        if (bracket) return whole;
        const path = known.has(token) ? token : [...known].find((p) => p.endsWith(`/${token}`));
        return path ? `[\`${token}\`](#file:${encodeURI(path)})` : whole;
      });
    })
    .join("\n");
}

/** How the pages are read, front to back. */
export const READING_ORDER: WrittenKind[] = ["overview", "getting_started", "key_concepts", "how_it_works", "architecture", "active_landscape", "glossary", "module", "file"];

/**
 * Pages are written leaves first, so what is above them can describe what is below: modules, then
 * the architecture, key concepts and the walk-through, then the overview that sums them up, then the
 * pages that stand on their own.
 */
export function writingOrder(pages: readonly { id: string; kind: string }[]): string[] {
  const order = ["module", "file", "architecture", "key_concepts", "how_it_works", "overview", "getting_started", "active_landscape", "glossary"];
  const rank = (kind: string) => (order.includes(kind) ? order.indexOf(kind) : order.length);
  return [...pages].sort((a, b) => rank(a.kind) - rank(b.kind)).map((page) => page.id);
}

export function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 100) / 10}k` : String(tokens);
}
