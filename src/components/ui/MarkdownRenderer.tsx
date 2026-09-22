import { memo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import styles from "./MarkdownRenderer.module.css";

interface MarkdownRendererProps {
  content: string;
  className?: string;
  onLinkClick?: (href: string, event: React.MouseEvent<HTMLAnchorElement>) => void;
}

const isExternalLink = (href?: string) => Boolean(href && /^(https?:|mailto:|tel:|\/\/)/i.test(href));

/** Renders untrusted Markdown without allowing raw HTML. */
export const MarkdownRenderer = memo(({ content, className = "", onLinkClick }: MarkdownRendererProps) => (
  <div className={`${styles.root} ${className}`}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
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
