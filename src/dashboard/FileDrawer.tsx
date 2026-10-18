import { useState } from "react";
import { Bot, Copy, ExternalLink, X } from "lucide-react";

import { toRepositoryError } from "../architecture/client";
import { Button, Callout } from "../components/ui";
import type { DashboardClient } from "./client";
import { ago, compact, percent } from "./format";
import type { FileDetail, FileFinding } from "./model";
import { useLoad } from "./useLoad";
import styles from "./Dashboard.module.css";

export interface FileDrawerProps {
  client: DashboardClient;
  root: string;
  file: string;
  revision: number;
  onClose(): void;
  onOpenFile(file: string, line?: number): void;
  onSelectFile(file: string): void;
  handToAgent?(prompt: string, files: string[]): void;
}

const SEVERITY_ORDER = ["high", "medium", "low", "info"];
const TOP_ISSUES = 3;

/** One sentence a newcomer can act on, from the facts alone (no score exists yet). */
export function verdict(detail: FileDetail): string {
  const { row } = detail;
  const worst = detail.findings[0];
  if (worst) {
    const more = detail.findings.length > 1 ? ` and ${detail.findings.length - 1} more` : "";
    return `${worst.title}${more}.`;
  }
  if (row.importers >= 10 && row.commits >= 10) return `Changes often and ${row.importers} files import it: changes here reach far.`;
  if (row.importers === 0 && !row.test) return "Nothing imports this file; it is an entry point, a script, or possibly unused.";
  if (row.commits === 0) return "No change to this file in the analysed history.";
  return "No findings for this file.";
}

/**
 * One file beside the page it was opened from. Non-modal: the page stays live, and picking
 * another file swaps the content. Verdict and actions first, the top issues, the vital signs,
 * and everything else folded.
 */
export function FileDrawer({ client, root, file, revision, onClose, onOpenFile, onSelectFile, handToAgent }: FileDrawerProps) {
  const { value: detail, error } = useLoad(() => client.file(root, file), [client, root, file, revision]);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  const promptFor = async (finding?: FileFinding) => {
    setCopyError(null);
    try {
      return await client.prompt(root, file, finding?.id);
    } catch (failure) {
      setCopyError(toRepositoryError(failure).message);
      return null;
    }
  };
  const copy = async (finding?: FileFinding) => {
    const text = await promptFor(finding);
    if (text === null) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(finding?.id ?? "file");
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopyError("The clipboard is not available.");
    }
  };
  const hand = async (finding?: FileFinding) => {
    const text = await promptFor(finding);
    if (text !== null && handToAgent) handToAgent(text, [file, ...(finding?.otherFiles ?? [])]);
  };

  return (
    <aside className={styles.drawer} aria-label={`File ${file}`}>
      <div className={styles.drawerHead}>
        <h3 className={styles.drawerTitle}>{file}</h3>
        <span className={styles.spacer} />
        <Button variant="ghost" icon={<X size={14} />} aria-label="Close" onClick={onClose} />
      </div>
      {error ? <Callout variant="danger">{error}</Callout> : null}
      {!detail ? (
        !error ? <div role="status">Loading…</div> : null
      ) : (
        <>
          <p className={styles.verdict}>{verdict(detail)}</p>
          <div className={styles.actions}>
            <Button variant="primary" icon={<Copy size={14} />} onClick={() => void copy()}>
              {copied === "file" ? "Copied" : "Copy fix prompt"}
            </Button>
            {handToAgent ? (
              <Button variant="secondary" icon={<Bot size={14} />} onClick={() => void hand()}>
                Hand to agent
              </Button>
            ) : null}
            <Button variant="ghost" icon={<ExternalLink size={14} />} onClick={() => onOpenFile(file)}>
              Open
            </Button>
          </div>
          {copyError ? <Callout variant="danger">{copyError}</Callout> : null}
          <Vitals detail={detail} />
          <Issues detail={detail} copied={copied} onCopy={copy} onHand={handToAgent ? hand : undefined} onOpenFile={onOpenFile} />
          <details className={styles.details}>
            <summary>Imported by ({detail.row.importers})</summary>
            <Links items={detail.importers.map((n) => ({ path: n.path, note: n.weight > 1 ? `${n.weight} imports` : "" }))} onSelect={onSelectFile} />
          </details>
          <details className={styles.details}>
            <summary>Imports ({detail.row.imports})</summary>
            <Links items={detail.imports.map((n) => ({ path: n.path, note: "" }))} onSelect={onSelectFile} />
          </details>
          <details className={styles.details}>
            <summary>History</summary>
            {detail.authors.length === 0 ? (
              <p className={styles.muted}>No change in the analysed history.</p>
            ) : (
              <ul className={styles.list}>
                {detail.authors.map((author) => (
                  <li key={author.name}>
                    {author.name}: {author.commits} commits ({percent(author.share)})
                  </li>
                ))}
              </ul>
            )}
            {detail.coChanged.length ? (
              <>
                <p className={styles.muted}>Usually changes together with</p>
                <Links items={detail.coChanged.map((c) => ({ path: c.path, note: `${c.commits} times, ${percent(c.confidence)}` }))} onSelect={onSelectFile} />
              </>
            ) : null}
          </details>
          {detail.groups.length ? (
            <details className={styles.details}>
              <summary>Groups</summary>
              <ul className={styles.list}>
                {detail.groups.map((group) => (
                  <li key={group}>{group}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </aside>
  );
}

function Vitals({ detail }: { detail: FileDetail }) {
  const { row } = detail;
  return (
    <div className={styles.vitals} aria-label="Vital signs">
      <span>
        <strong>{compact(row.lines)}</strong> lines
      </span>
      <span>
        <strong>{row.language}</strong>
      </span>
      <span>
        imported by <strong>{row.importers}</strong>
      </span>
      <span>
        reach <strong>{detail.blastRadius}</strong> files in 2 hops
      </span>
      <span>
        <strong>{row.commits}</strong> commits
      </span>
      {row.owner ? (
        <span>
          main author <strong>{row.owner}</strong>
          {row.ownerShare !== null ? ` ${percent(row.ownerShare)}` : ""}
        </span>
      ) : null}
      {row.lastChange ? <span>changed {ago(row.lastChange)}</span> : null}
      {row.test ? <span>test file</span> : null}
    </div>
  );
}

function Issues({ detail, copied, onCopy, onHand, onOpenFile }: { detail: FileDetail; copied: string | null; onCopy(f: FileFinding): void; onHand?(f: FileFinding): void; onOpenFile(file: string, line?: number): void }) {
  const [all, setAll] = useState(false);
  if (!detail.findings.length) return null;
  const sorted = [...detail.findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  const shown = all ? sorted : sorted.slice(0, TOP_ISSUES);
  return (
    <section aria-label="Issues">
      <h4 className={styles.muted}>{all || sorted.length <= TOP_ISSUES ? "Issues" : "Top issues"}</h4>
      {shown.map((finding) => (
        <div key={finding.id} className={styles.issue}>
          <div className={styles.issueHead}>
            <span className={`${styles.dot} ${styles[finding.severity] ?? styles.info}`} aria-label={finding.severity} />
            <strong>{finding.title}</strong>
          </div>
          <p>{finding.summary}</p>
          <p className={styles.muted}>{finding.rationale}</p>
          {finding.interpretation ? <p className={styles.muted}>{finding.interpretation}</p> : null}
          <div className={styles.actions}>
            {finding.lines.slice(0, 4).map((line) => (
              <button key={line} type="button" className={styles.link} onClick={() => onOpenFile(detail.row.path, line)}>
                line {line}
              </button>
            ))}
            {finding.otherFiles.slice(0, 3).map((other) => (
              <button key={other} type="button" className={styles.link} onClick={() => onOpenFile(other)}>
                {other}
              </button>
            ))}
            <span className={styles.spacer} />
            <Button variant="ghost" icon={<Copy size={14} />} onClick={() => onCopy(finding)}>
              {copied === finding.id ? "Copied" : "Copy prompt"}
            </Button>
            {onHand ? (
              <Button variant="ghost" icon={<Bot size={14} />} onClick={() => onHand(finding)} aria-label={`Hand ${finding.title} to an agent`} />
            ) : null}
          </div>
        </div>
      ))}
      {sorted.length > TOP_ISSUES ? (
        <button type="button" className={styles.link} onClick={() => setAll((open) => !open)}>
          {all ? "Show fewer" : `All issues (${sorted.length})`}
        </button>
      ) : null}
    </section>
  );
}

function Links({ items, onSelect }: { items: { path: string; note: string }[]; onSelect(path: string): void }) {
  if (!items.length) return <p className={styles.muted}>None.</p>;
  return (
    <ul className={styles.list}>
      {items.map((item) => (
        <li key={item.path}>
          <button type="button" className={styles.link} onClick={() => onSelect(item.path)}>
            {item.path}
          </button>{" "}
          {item.note ? <span className={styles.muted}>{item.note}</span> : null}
        </li>
      ))}
    </ul>
  );
}
