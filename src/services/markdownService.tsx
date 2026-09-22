import React from "react";

// File mentions parsing function
export function parseInlineMarkdown(text: string): React.ReactNode[] {
  if (!text) return [];

  const parts: React.ReactNode[] = [];
  let remaining = text;
  let keyIdx = 0;

  while (remaining.length > 0) {
    let firstMatch: { index: number; length: number; type: string; content: string; extra?: string } | null = null;

    const updateFirstMatch = (match: RegExpMatchArray | null, type: string) => {
      if (match && match.index !== undefined) {
        if (!firstMatch || match.index < firstMatch.index) {
          firstMatch = {
            index: match.index,
            length: match[0].length,
            type,
            content: match[1],
            extra: match[2]
          };
        }
      }
    };

    // Match bold first
    const mBold = remaining.match(/\*\*([^*]+)\*\*/);
    if (mBold && mBold.index !== undefined) {
      firstMatch = { index: mBold.index, length: mBold[0].length, type: "bold", content: mBold[1] };
    }

    // Match code
    const mCode = remaining.match(/`([^`]+)`/);
    updateFirstMatch(mCode, "code");

    // Match link
    const mLink = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/);
    updateFirstMatch(mLink, "link");

    // Match italic underscore
    const mItalicUnderscore = remaining.match(/_([^_]+)_/);
    updateFirstMatch(mItalicUnderscore, "italic");

    // Match italic asterisk
    const mItalic = remaining.match(/\*([^*]+)\*/);
    if (mItalic && mItalic.index !== undefined) {
      const isBold = mBold && mBold.index !== undefined && 
                     mItalic.index >= mBold.index && 
                     (mItalic.index + mItalic[0].length) <= (mBold.index + mBold[0].length);
      if (!isBold) {
        updateFirstMatch(mItalic, "italic");
      }
    }

    if (!firstMatch) {
      parts.push(<span key={`text-${keyIdx++}`}>{remaining}</span>);
      break;
    }

    if (firstMatch.index > 0) {
      parts.push(<span key={`text-${keyIdx++}`}>{remaining.substring(0, firstMatch.index)}</span>);
    }

    const tokenKey = `token-${keyIdx++}`;
    if (firstMatch.type === "bold") {
      parts.push(<strong key={tokenKey} className="font-bold text-[var(--text-light)]">{firstMatch.content}</strong>);
    } else if (firstMatch.type === "italic") {
      parts.push(<em key={tokenKey} className="italic text-[var(--text-normal)]">{firstMatch.content}</em>);
    } else if (firstMatch.type === "code") {
      parts.push(
        <code key={tokenKey} className="px-1.5 py-0.5 rounded bg-[var(--bg-sidebar)] border border-[var(--border-color)] text-[var(--color-status-danger)] font-mono text-[11px]">
          {firstMatch.content}
        </code>
      );
    } else if (firstMatch.type === "link") {
      const url = firstMatch.extra || "";
      parts.push(
        <a 
          key={tokenKey} 
          href={url} 
          target="_blank" 
          rel="noopener noreferrer" 
          className="text-[var(--color-secondary)] hover:text-[var(--color-secondary)] underline font-semibold transition-colors"
        >
          {firstMatch.content}
        </a>
      );
    }

    remaining = remaining.substring(firstMatch.index + firstMatch.length);
  }

  return parts;
}

export function formatMarkdownBlocks(text: string): React.ReactNode[] {
  if (!text) return [];
  
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let keyIdx = 0;
  
  let currentList: { type: "ul" | "ol"; items: React.ReactNode[] } | null = null;
  let currentQuote: React.ReactNode[] | null = null;
  let inTable = false;
  let tableHeaders: string[] = [];
  let tableRows: string[][] = [];

  const splitTableCells = (line: string): string[] => {
    const cells = line.split("|").map(c => c.trim());
    if (cells[0] === "") cells.shift();
    if (cells[cells.length - 1] === "") cells.pop();
    return cells;
  };

  const flushTable = () => {
    if (inTable) {
      elements.push(
        <div key={`table-${keyIdx++}`} className="my-3 rounded-lg border border-[var(--border-color)]">
          <table className="w-full text-left border-collapse font-sans text-[11px]">
            <thead>
              <tr className="bg-[var(--bg-sidebar)] border-b border-[var(--border-color)]">
                {tableHeaders.map((h, idx) => (
                  <th key={idx} className="px-3 py-2 font-semibold text-[var(--text-light)]">
                    {parseInlineMarkdown(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, rowIdx) => (
                <tr key={rowIdx} className="border-b border-[var(--border-color)]/40 last:border-none hover:bg-[var(--bg-sidebar)]/35 transition-colors">
                  {row.map((cell, cellIdx) => (
                    <td key={cellIdx} className="px-3 py-2 text-[var(--text-normal)]">
                      {parseInlineMarkdown(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      inTable = false;
      tableHeaders = [];
      tableRows = [];
    }
  };

  const flushList = () => {
    if (currentList) {
      const Tag = currentList.type;
      elements.push(
        <Tag key={`list-${keyIdx++}`} className={Tag === "ol" ? "list-decimal pl-5 space-y-1 my-2" : "list-disc pl-5 space-y-1 my-2"}>
          {currentList.items.map((item, idx) => (
            <li key={idx} className="leading-relaxed text-[11px] text-[var(--text-normal)]">
              {item}
            </li>
          ))}
        </Tag>
      );
      currentList = null;
    }
  };

  const flushQuote = () => {
    if (currentQuote) {
      elements.push(
        <blockquote key={`quote-${keyIdx++}`} className="border-l-4 border-[var(--color-secondary-border)] pl-3 py-1 my-2 bg-[var(--bg-sidebar)]/20 rounded-r text-[var(--text-muted)] italic space-y-1 text-left">
          {currentQuote.map((lineContent, idx) => (
            <p key={idx} className="leading-relaxed text-[11px] my-1">
              {lineContent}
            </p>
          ))}
        </blockquote>
      );
      currentQuote = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Table Row Detection
    const isTableRow = trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.includes("|", 1);
    
    if (isTableRow) {
      flushList();
      flushQuote();
      if (!inTable) {
        // Look ahead to check if the next line is a separator row
        const nextLine = lines[i + 1]?.trim();
        const isSeparator = nextLine && nextLine.startsWith("|") && nextLine.endsWith("|") && /^[|:\-\s]+$/.test(nextLine);
        if (isSeparator) {
          tableHeaders = splitTableCells(line);
          i++; // skip separator line
          inTable = true;
        } else {
          tableHeaders = splitTableCells(line).map((_, idx) => `Column ${idx + 1}`);
          tableRows.push(splitTableCells(line));
          inTable = true;
        }
      } else {
        tableRows.push(splitTableCells(line));
      }
      continue;
    } else {
      flushTable();
    }

    // Contiguous Blockquote Detection
    if (trimmed.startsWith("> ")) {
      flushList();
      if (!currentQuote) {
        currentQuote = [];
      }
      currentQuote.push(parseInlineMarkdown(trimmed.substring(2)));
      continue;
    } else {
      flushQuote();
    }

    if (trimmed.startsWith("### ")) {
      flushList();
      elements.push(
        <h4 key={`h-${keyIdx++}`} className="text-[11px] font-bold text-[var(--text-light)] mt-3 mb-1.5 uppercase font-mono tracking-wider">
          {parseInlineMarkdown(trimmed.substring(4))}
        </h4>
      );
    } else if (trimmed.startsWith("## ")) {
      flushList();
      elements.push(
        <h3 key={`h-${keyIdx++}`} className="text-xs font-bold text-[var(--text-light)] mt-4 mb-2 border-b border-[var(--border-color)]/30 pb-1">
          {parseInlineMarkdown(trimmed.substring(3))}
        </h3>
      );
    } else if (trimmed.startsWith("# ")) {
      flushList();
      elements.push(
        <h2 key={`h-${keyIdx++}`} className="text-sm font-bold text-[var(--text-light)] mt-5 mb-2.5">
          {parseInlineMarkdown(trimmed.substring(2))}
        </h2>
      );
    } else if (trimmed === "---" || trimmed === "***") {
      flushList();
      elements.push(<hr key={`hr-${keyIdx++}`} className="border-[var(--border-color)]/50 my-3" />);
    } else if (/^\d+\.\s+/.test(trimmed)) {
      const match = trimmed.match(/^(\d+)\.\s+/);
      const content = trimmed.substring(match![0].length);
      if (!currentList || currentList.type !== "ol") {
        flushList();
        currentList = { type: "ol", items: [] };
      }
      currentList.items.push(parseInlineMarkdown(content));
    } else if (/^[-*•]\s+/.test(trimmed)) {
      const match = trimmed.match(/^[-*•]\s+/);
      const content = trimmed.substring(match![0].length);
      if (!currentList || currentList.type !== "ul") {
        flushList();
        currentList = { type: "ul", items: [] };
      }
      currentList.items.push(parseInlineMarkdown(content));
    } else if (trimmed === "") {
      flushList();
      elements.push(<div key={`spacer-${keyIdx++}`} className="h-1" />);
    } else {
      flushList();
      elements.push(
        <p key={`p-${keyIdx++}`} className="leading-relaxed text-[11px] text-[var(--text-normal)] my-1 text-left">
          {parseInlineMarkdown(line)}
        </p>
      );
    }
  }
  
  flushTable();
  flushList();
  flushQuote();
  return elements;
}

export function formatMessageText(text: string): React.ReactNode[] {
  if (!text) return [];
  
  const codeBlockRegex = /```(\w*)\s*\r?\n([\s\S]*?)```/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const matchIndex = match.index;
    const lang = (match[1] || "plaintext").toLowerCase();
    const code = match[2].trim();
    
    if (matchIndex > lastIndex) {
      const beforeText = text.substring(lastIndex, matchIndex);
      parts.push(...formatMarkdownBlocks(beforeText));
    }
    
    if (lang === "markdown" || lang === "md") {
      parts.push(
        <div key={`md-${matchIndex}`} className="my-3 p-3 border border-[var(--border-color)] rounded-lg bg-[var(--bg-app)]/30 w-full text-left font-sans text-xs">
          {formatMarkdownBlocks(code)}
        </div>
      );
    } else {
      parts.push(
        <div 
          key={`code-${matchIndex}`} 
          className="my-3 border border-[var(--border-color)] rounded-lg overflow-hidden bg-[var(--color-surface-sunken)] w-full flex flex-col font-sans"
        >
          <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-sidebar)]/80 border-b border-[var(--border-color)] select-none flex-shrink-0">
            <span className="text-[10px] uppercase font-mono font-bold text-[var(--color-secondary)]">{lang}</span>
            <button
              className="text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors cursor-pointer bg-transparent border-none p-0"
              onClick={() => { navigator.clipboard.writeText(code); }}
              title="Copy code"
            >
              Copy
            </button>
          </div>
          <pre className="m-0 whitespace-pre-wrap break-words p-3 text-[10px] leading-relaxed font-mono text-[var(--text-normal)]">
            <code>{code}</code>
          </pre>
        </div>
      );
    }
    
    lastIndex = codeBlockRegex.lastIndex;
  }
  
  if (lastIndex < text.length) {
    parts.push(...formatMarkdownBlocks(text.substring(lastIndex)));
  }
  
  return parts;
}
