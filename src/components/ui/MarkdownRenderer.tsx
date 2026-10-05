import { memo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import styles from "./MarkdownRenderer.module.css";
import type { ChatSearchMatch } from "./chatSearch";

interface MarkdownRendererProps {
  content: string;
  className?: string;
  onLinkClick?: (href: string, event: React.MouseEvent<HTMLAnchorElement>) => void;
  renderText?: (text: string, sourceOffset?: number) => ReactNode;
  searchMatches?: ChatSearchMatch[];
  activeSearchMatch?: ChatSearchMatch;
}

const isExternalLink = (href?: string) => Boolean(href && /^(https?:|mailto:|tel:|\/\/)/i.test(href));

const rehypeSearchHighlights = (options: { content: string; matches: ChatSearchMatch[]; active?: ChatSearchMatch }) => (tree: any) => {
    const visit = (node: any) => {
      if (node.type === "text" && node.position && typeof node.value === "string") {
        const start = node.position.start.offset;
        const end = node.position.end.offset;
        const valueStart = options.content.indexOf(node.value, Math.max(0, start - 3));
        const sourceStart = valueStart >= 0 && valueStart < end ? valueStart : start;
        const sourceEnd = sourceStart + node.value.length;
        const ranges = options.matches
          .map((match) => ({ ...match, start: Math.max(match.start, sourceStart), end: Math.min(match.end, sourceEnd) }))
          .filter((match) => match.start < match.end)
          .sort((a, b) => a.start - b.start);
        if (ranges.length) {
          const children: any[] = [];
          let cursor = sourceStart;
          for (const match of ranges) {
            if (match.start > cursor) children.push({ type: "text", value: node.value.slice(cursor - sourceStart, match.start - sourceStart) });
            children.push({
              type: "element",
              tagName: "mark",
              properties: {
                "data-testid": "chat-search-highlight",
                "data-active": options.active?.occurrence === match.occurrence ? "true" : "false",
              },
              children: [{ type: "text", value: node.value.slice(match.start - sourceStart, match.end - sourceStart) }],
            });
            cursor = match.end;
          }
          if (cursor < sourceEnd) children.push({ type: "text", value: node.value.slice(cursor - sourceStart) });
          return children;
        }
      }
      if (node.children) {
        const replacement: any[] = [];
        for (const child of node.children) {
          const result = visit(child);
          if (Array.isArray(result)) replacement.push(...result);
          else replacement.push(child);
        }
        node.children = replacement;
      }
      return undefined;
    };
  visit(tree);
};

/** Renders untrusted Markdown without allowing raw HTML. */
export const MarkdownRenderer = memo(({ content, className = "", onLinkClick, renderText: _renderText, searchMatches = [], activeSearchMatch }: MarkdownRendererProps) => (
  <div className={`${styles.root} ${className}`}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[
        ...(searchMatches.length ? [[rehypeSearchHighlights, { content, matches: searchMatches, active: activeSearchMatch }] as [typeof rehypeSearchHighlights, { content: string; matches: ChatSearchMatch[]; active?: ChatSearchMatch }] ] : []),
        [rehypeHighlight, { detect: false, ignoreMissing: true }],
      ]}
      components={{
        h1: ({ children }) => <h1 className={styles.heading1}>{children}</h1>,
        h2: ({ children }) => <h2 className={styles.heading2}>{children}</h2>,
        h3: ({ children }) => <h3 className={styles.heading3}>{children}</h3>,
        p: ({ children }) => <p className={styles.paragraph}>{children}</p>,
        a: ({ children, href }) => (
          <a href={href} {...(isExternalLink(href) ? { target: "_blank", rel: "noopener noreferrer" } : {})} className={styles.link}
            onClick={(event) => { if (href && onLinkClick) onLinkClick(href, event); }}>
            {children}
          </a>
        ),
        ul: ({ children }) => <ul className={`${styles.list} ${styles.unordered}`}>{children}</ul>,
        ol: ({ children }) => <ol className={`${styles.list} ${styles.ordered}`}>{children}</ol>,
        li: ({ children }) => <li className={styles.listItem}>{children}</li>,
        blockquote: ({ children }) => <blockquote className={styles.quote}>{children}</blockquote>,
        table: ({ children }) => <table className={styles.table}>{children}</table>,
        thead: ({ children }) => <thead className={styles.tableHead}>{children}</thead>,
        th: ({ children }) => <th className={`${styles.cell} ${styles.headerCell}`}>{children}</th>,
        td: ({ children }) => <td className={styles.cell}>{children}</td>,
        tr: ({ children }) => <tr className={styles.row}>{children}</tr>,
        code: ({ children, className: codeClassName, ...props }) => {
          const isBlock = Boolean(codeClassName?.includes("language-"));
          return isBlock ? (
            <code className={`${codeClassName ?? ""} ${styles.code}`} {...props}>{children}</code>
          ) : (
            <code className={`${styles.code} ${styles.inlineCode}`} {...props}>{children}</code>
          );
        },
        pre: ({ children }) => <pre className={styles.pre}>{children}</pre>,
      }}
    >
      {content}
    </ReactMarkdown>
  </div>
));
