import React from "react";

// ── Types ────────────────────────────────────────────────────────────
interface ParsedBlock {
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
const MAX_BLOCKS = 200;
const MAX_INLINE_ITERATIONS = 500;

// ── Inline Markdown (safe, iteration-limited) ────────────────────────

function renderInline(text: string): React.ReactNode {
  if (!text) return null;

  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;
  let iterations = 0;

  while (remaining.length > 0 && iterations < MAX_INLINE_ITERATIONS) {
    iterations++;

    // Find the earliest inline match
    let best: { idx: number; len: number; type: string; cap: string[]; } | null = null;

    const patterns: [RegExp, string][] = [
      [/\*\*([^*]+)\*\*/, "bold"],
      [/`([^`]+)`/, "code"],
      [/\[([^\]]+)\]\(([^)]+)\)/, "link"],
      [/_([^_]+)_/, "italic"],
    ];

    for (const [re, type] of patterns) {
      const m = remaining.match(re);
      if (m && m.index !== undefined) {
        // For bold, also check italic to avoid overlap
        if (type === "italic" && m[0].length <= 2) continue;
        if (!best || m.index < best.idx) {
          best = { idx: m.index, len: m[0].length, type, cap: [...m] };
        }
      }
    }

    if (!best || best.len === 0) {
      parts.push(<span key={`t-${key++}`}>{remaining}</span>);
      break;
    }

    // Text before the match
    if (best.idx > 0) {
      parts.push(<span key={`t-${key++}`}>{remaining.substring(0, best.idx)}</span>);
    }

    const k = `i-${key++}`;
    switch (best.type) {
      case "bold":
        parts.push(<strong key={k} className="font-bold text-[var(--text-light)]">{best.cap[1]}</strong>);
        break;
      case "code":
        parts.push(
          <code key={k} className="px-1.5 py-0.5 rounded bg-[var(--bg-sidebar)] border border-[var(--border-color)] text-[var(--color-status-danger)] font-mono text-[11px]">
            {best.cap[1]}
          </code>
        );
        break;
      case "link":
        parts.push(
          <span key={k} className="text-[var(--color-secondary)] font-semibold">
            {best.cap[1]}
          </span>
        );
        break;
      case "italic":
        parts.push(<em key={k} className="italic text-[var(--text-normal)]">{best.cap[1]}</em>);
        break;
    }

    remaining = remaining.substring(best.idx + best.len);
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

// ── Block Parser (string → ParsedBlock[]) ────────────────────────────

function parseBlocks(text: string): ParsedBlock[] {
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

function renderBlocks(blocks: ParsedBlock[]): React.ReactNode[] {
  return blocks.map((block, idx) => {
    const k = `block-${idx}`;

    switch (block.type) {
      case "heading": {
        const cls = block.level === 1
          ? "text-sm font-bold text-[var(--text-light)] mt-5 mb-2.5"
          : block.level === 2
            ? "text-xs font-bold text-[var(--text-light)] mt-4 mb-2 border-b border-[var(--border-color)]/30 pb-1"
            : "text-[11px] font-bold text-[var(--text-light)] mt-3 mb-1.5 uppercase font-mono tracking-wider";
        return <div key={k} className={cls}>{renderInline(block.content)}</div>;
      }

      case "paragraph":
        return (
          <p key={k} className="leading-relaxed text-[11px] text-[var(--text-normal)] my-1 text-left">
            {renderInline(block.content)}
          </p>
        );

      case "code":
        return (
          <div key={k} className="my-3 border border-[var(--border-color)] rounded-lg overflow-hidden bg-[var(--color-surface-sunken)] w-full flex flex-col font-sans">
            <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-sidebar)]/80 border-b border-[var(--border-color)] select-none flex-shrink-0">
              <span className="text-[10px] uppercase font-mono font-bold text-[var(--color-secondary)]">{block.language}</span>
              <button
                className="text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors cursor-pointer bg-transparent border-none p-0"
                onClick={() => { navigator.clipboard.writeText(block.content); }}
                title="Copy code"
              >
                Copy
              </button>
            </div>
            <pre className="m-0 whitespace-pre-wrap break-words p-3 text-[10px] leading-relaxed font-mono text-[var(--text-normal)]">
              <code>{block.content}</code>
            </pre>
          </div>
        );

      case "table":
        return (
          <div key={k} className="my-3 rounded-lg border border-[var(--border-color)]">
            <table className="w-full text-left border-collapse font-sans text-[11px]">
              <thead>
                <tr className="bg-[var(--bg-sidebar)] border-b border-[var(--border-color)]">
                  {(block.headers || []).map((h, hi) => (
                    <th key={hi} className="px-3 py-2 font-semibold text-[var(--text-light)]">{renderInline(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(block.rows || []).map((row, ri) => (
                  <tr key={ri} className="border-b border-[var(--border-color)]/40 last:border-none hover:bg-[var(--bg-sidebar)]/35 transition-colors">
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-3 py-2 text-[var(--text-normal)]">{renderInline(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );

      case "list": {
        const Tag = block.listType === "ol" ? "ol" : "ul";
        const listCls = block.listType === "ol" ? "list-decimal pl-5 space-y-1 my-2" : "list-disc pl-5 space-y-1 my-2";
        return (
          <Tag key={k} className={listCls}>
            {(block.items || []).map((item, li) => (
              <li key={li} className="leading-relaxed text-[11px] text-[var(--text-normal)]">{renderInline(item)}</li>
            ))}
          </Tag>
        );
      }

      case "quote":
        return (
          <blockquote key={k} className="border-l-4 border-[var(--color-secondary-border)] pl-3 py-1 my-2 bg-[var(--bg-sidebar)]/20 rounded-r text-[var(--text-muted)] italic space-y-1 text-left">
            {(block.lines || [block.content]).map((line, li) => (
              <p key={li} className="leading-relaxed text-[11px] my-1">{renderInline(line)}</p>
            ))}
          </blockquote>
        );

      case "hr":
        return <hr key={k} className="border-[var(--border-color)]/50 my-3" />;

      case "spacer":
        return <div key={k} className="h-1" />;

      default:
        return null;
    }
  });
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Process an LLM response string into safe, renderable React nodes.
 * This is the single entry point the UI should call.
 * - Parses markdown blocks with safety limits
 * - Uses lightweight <pre><code> instead of Monaco for code blocks
 * - Caps iterations to prevent infinite loops
 * - Wraps everything in a try/catch with a plain-text fallback
 */
export function processResponse(text: string): React.ReactNode {
  if (!text) return null;

  try {
    const blocks = parseBlocks(text);
    const rendered = renderBlocks(blocks);
    return <div className="space-y-0">{rendered}</div>;
  } catch (err: any) {
    console.error("[ResponseService] Failed to process response:", err);
    // Fallback: render as plain preformatted text
    return (
      <pre className="whitespace-pre-wrap text-[11px] text-[var(--text-normal)] font-mono leading-relaxed">
        {text}
      </pre>
    );
  }
}
