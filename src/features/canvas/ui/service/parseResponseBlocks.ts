export const MAX_BLOCKS = 200;


// ── Types ────────────────────────────────────────────────────────────
export interface ParsedBlock {
  type: "heading" | "paragraph" | "code" | "table" | "list" | "quote" | "hr" | "spacer";
  content: string;
  language?: string;
  level?: number;
  listType?: "ul" | "ol";
  items?: string[];
  headers?: string[];
  rows?: string[][];
  lines?: string[];
}

// ── Safety Constants ─────────────────────────────────────────────────

export function parseBlocks(text: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length && blocks.length < MAX_BLOCKS) {
    const line = lines[i];
    const trimmed = line.trim();

    // --- Code block ---
    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim() || "plaintext";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({ type: "code", content: codeLines.join("\n"), language: lang });
      continue;
    }

    // --- Headings ---
    if (trimmed.startsWith("### ")) {
      blocks.push({ type: "heading", content: trimmed.slice(4), level: 3 });
      i++; continue;
    }
    if (trimmed.startsWith("## ")) {
      blocks.push({ type: "heading", content: trimmed.slice(3), level: 2 });
      i++; continue;
    }
    if (trimmed.startsWith("# ")) {
      blocks.push({ type: "heading", content: trimmed.slice(2), level: 1 });
      i++; continue;
    }

    // --- Horizontal Rule ---
    if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
      blocks.push({ type: "hr", content: "" });
      i++; continue;
    }

    // --- Table ---
    if (trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.includes("|", 1)) {
      const splitCells = (l: string) => {
        const cells = l.split("|").map(c => c.trim());
        if (cells[0] === "") cells.shift();
        if (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
        return cells;
      };

      const headers = splitCells(trimmed);
      i++;

      // Skip separator row
      if (i < lines.length) {
        const nextTrimmed = lines[i].trim();
        if (nextTrimmed.startsWith("|") && /^[|:\-\s]+$/.test(nextTrimmed)) {
          i++;
        }
      }

      const rows: string[][] = [];
      while (i < lines.length) {
        const rowTrimmed = lines[i].trim();
        if (!rowTrimmed.startsWith("|") || !rowTrimmed.endsWith("|")) break;
        rows.push(splitCells(rowTrimmed));
        i++;
      }

      blocks.push({ type: "table", content: "", headers, rows });
      continue;
    }

    // --- Blockquote ---
    if (trimmed.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("> ")) {
        quoteLines.push(lines[i].trim().slice(2));
        i++;
      }
      blocks.push({ type: "quote", content: quoteLines.join("\n"), lines: quoteLines });
      continue;
    }

    // --- Unordered List ---
    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, ""));
        i++;
      }
      blocks.push({ type: "list", content: "", listType: "ul", items });
      continue;
    }

    // --- Ordered List ---
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ type: "list", content: "", listType: "ol", items });
      continue;
    }

    // --- Empty line / spacer ---
    if (trimmed === "") {
      blocks.push({ type: "spacer", content: "" });
      i++; continue;
    }

    // --- Paragraph ---
    blocks.push({ type: "paragraph", content: trimmed });
    i++;
  }

  return blocks;
}

// ── Block Renderer (ParsedBlock[] → React.ReactNode[]) ───────────────
