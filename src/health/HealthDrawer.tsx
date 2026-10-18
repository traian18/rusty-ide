import { useState } from "react";
import { Copy, ExternalLink, X } from "lucide-react";

import { toRepositoryError } from "../architecture/client";
import { Button, Callout } from "../components/ui";
import { useLoad } from "../dashboard/useLoad";
import d from "../dashboard/Dashboard.module.css";
import type { HealthClient } from "./client";
import { BandChip } from "./CodeHealthPage";
import { CATEGORY_LABEL, detectorLabel, type Category, type HealthFileDetail, type ScoredFinding } from "./model";
import s from "./Health.module.css";

export interface HealthDrawerProps {
  client: HealthClient;
  root: string;
  path: string;
  revision: number;
  onClose(): void;
  onOpenFile(file: string, line?: number): void;
}

/** One file's health beside the page: verdict, the issues that cost the most, and prompts to fix them. */
export function HealthDrawer({ client, root, path, revision, onClose, onOpenFile }: HealthDrawerProps) {
  const { value: detail, error } = useLoad(() => client.file(root, path), [client, root, path, revision]);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const copy = async (finding?: ScoredFinding) => {
    setCopyError(null);
    try {
      const text = await client.prompt(root, path, finding?.id);
      await navigator.clipboard.writeText(text);
      setCopied(finding?.id ?? "file");
      setTimeout(() => setCopied(null), 2000);
    } catch (failure) {
      setCopyError(failure instanceof Error ? failure.message : toRepositoryError(failure).message);
    }
  };
  return (
    <aside className={d.drawer} aria-label={`Health of ${path}`}>
      <div className={d.drawerHead}>
        <h3 className={d.drawerTitle}>{path}</h3>
        <span className={d.spacer} />
        <Button variant="ghost" icon={<X size={14} />} aria-label="Close" onClick={onClose} />
      </div>
      {error ? <Callout variant="danger">{error}</Callout> : null}
      {!detail ? (
        !error ? <div role="status">Loading…</div> : null
      ) : (
        <>
          <Verdict detail={detail} />
          <div className={d.actions}>
            <Button variant="primary" icon={<Copy size={14} />} onClick={() => void copy()} disabled={!detail.findings.length}>
              {copied === "file" ? "Copied" : "Copy fix prompt"}
            </Button>
            <Button variant="ghost" icon={<ExternalLink size={14} />} onClick={() => onOpenFile(path)}>
              Open
            </Button>
          </div>
          {copyError ? <Callout variant="danger">{copyError}</Callout> : null}
          <section aria-label="Issues">
            {detail.findings.length === 0 ? <p className={d.muted}>No issues found in this file.</p> : null}
            {detail.findings.map((f) => (
              <div key={f.id} className={s.issue}>
                <div className={s.issueHead}>
                  <span className={`${d.dot} ${d[f.severity === "critical" ? "high" : f.severity]}`} aria-label={f.severity} />
                  <strong>{detectorLabel(f.detector)}</strong>
                  <span className={d.muted}>{f.function ?? f.class ?? "whole file"}</span>
                  <span className={s.impact} title="Points this issue takes off the score">
                    {f.impact > 0 ? `−${f.impact.toFixed(2)}` : "no score impact"}
                  </span>
                </div>
                <p>{f.reason}</p>
                <div className={s.measured}>{Object.entries(f.measured).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(" · ")}</div>
                <div className={d.actions}>
                  {f.function || f.class ? (
                    <button type="button" className={d.link} onClick={() => onOpenFile(path, f.start_line)}>
                      {f.start_line === f.end_line ? `line ${f.start_line}` : `lines ${f.start_line}-${f.end_line}`}
                    </button>
                  ) : null}
                  <span className={d.spacer} />
                  <Button variant="ghost" icon={<Copy size={14} />} onClick={() => void copy(f)}>
                    {copied === f.id ? "Copied" : "Copy prompt"}
                  </Button>
                </div>
              </div>
            ))}
          </section>
          <details className={d.details}>
            <summary>Where the points go</summary>
            <ul className={d.list}>
              {(Object.entries(detail.defectCategories) as [Category, { raw: number; cap: number; applied: number }][]).map(([category, c]) => (
                <li key={category}>
                  {CATEGORY_LABEL[category]}: −{c.applied.toFixed(2)}
                  {c.raw > c.cap ? ` (capped from ${c.raw.toFixed(2)})` : ""}
                </li>
              ))}
            </ul>
          </details>
          {detail.functions.length ? (
            <details className={d.details}>
              <summary>Most complex functions</summary>
              <table className={d.table}>
                <thead>
                  <tr>
                    <th>Function</th>
                    <th className={d.num}>CCN</th>
                    <th className={d.num}>Nesting</th>
                    <th className={d.num}>Lines</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.functions.map((fn) => (
                    <tr key={`${fn.name}:${fn.startLine}`} onClick={() => onOpenFile(path, fn.startLine)}>
                      <td className={d.path}>{fn.name}</td>
                      <td className={d.num}>{fn.ccn}</td>
                      <td className={d.num}>{fn.maxNesting}</td>
                      <td className={d.num}>{fn.nloc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ) : null}
        </>
      )}
    </aside>
  );
}

function Verdict({ detail }: { detail: HealthFileDetail }) {
  const { row } = detail;
  const signals = detail.signals;
  return (
    <>
      <p className={d.verdict}>
        <BandChip score={row.defect} band={row.band} /> {row.defect !== null ? `maintainability ${row.maintainability?.toFixed(1)}, target ${detail.target.toFixed(1)}.` : "This language is not measured yet."}
      </p>
      <div className={d.vitals} aria-label="Vital signs">
        <span>
          <strong>{row.nloc}</strong> lines
        </span>
        <span>
          code −<strong>{row.structure.toFixed(2)}</strong>
        </span>
        <span>
          history −<strong>{row.history.toFixed(2)}</strong>
        </span>
        <span>
          imported by <strong>{detail.importers}</strong>
        </span>
        {signals ? (
          <>
            <span>
              <strong>{signals.commits_recent}</strong> recent commits
            </span>
            <span>
              <strong>{signals.fix_commits}</strong> bug fixes
            </span>
            {signals.owner ? (
              <span>
                main author <strong>{signals.owner.name}</strong> {Math.round(signals.owner_share_per_mille / 10)}%
              </span>
            ) : null}
            {signals.hotspot ? <span>hotspot</span> : null}
          </>
        ) : null}
        {detail.unclamped !== null && detail.unclamped < 1 ? <span>{detail.unclamped.toFixed(1)} before the floor</span> : null}
      </div>
    </>
  );
}
