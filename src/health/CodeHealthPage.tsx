import { useMemo, useState } from "react";

import { Button, Callout } from "../components/ui";
import { compact, percent } from "../dashboard/format";
import { useLoad } from "../dashboard/useLoad";
import d from "../dashboard/Dashboard.module.css";
import type { HealthClient } from "./client";
import { HealthDrawer } from "./HealthDrawer";
import { HealthMap } from "./HealthMap";
import { InfoPopover } from "./InfoPopover";
import { TrendCard } from "./TrendCard";
import { BAND_LABEL, bandOf, detectorLabel, totalFindings, type Band, type HealthReport, type SeverityCounts } from "./model";
import s from "./Health.module.css";

export interface CodeHealthPageProps {
  client: HealthClient;
  root: string;
  revision: number;
  openFile(file: string, line?: number): void;
}

type Tab = "files" | "issues" | "folders" | "map";
const PAGE = 200;

export function BandChip({ score, band }: { score: number | null; band?: Band | null }) {
  if (score === null) return <span className={d.muted}>not scored</span>;
  const b = band ?? bandOf(score);
  return (
    <span className={`${s.band} ${s[b]}`} title={BAND_LABEL[b]}>
      {score.toFixed(1)} · {BAND_LABEL[b]}
    </span>
  );
}

function Counts({ counts }: { counts: SeverityCounts }) {
  const parts = (["critical", "high", "medium", "low"] as const).filter((k) => counts[k] > 0);
  if (!parts.length) return <span className={d.muted}>–</span>;
  return (
    <>
      {parts.map((k) => (
        <span key={k} className={d.muted} title={`${counts[k]} ${k}`} style={{ marginRight: 6 }}>
          <span className={`${d.dot} ${d[k === "critical" ? "high" : k]}`} aria-hidden /> {counts[k]}
        </span>
      ))}
    </>
  );
}

/**
 * Code health for one repository: how healthy the code is, what pulls it down, and where; every
 * file opens a drawer with its issues and a prompt to fix them.
 */
export function CodeHealthPage({ client, root, revision, openFile }: CodeHealthPageProps) {
  const { value: report, error, loading } = useLoad(() => client.report(root), [client, root, revision]);
  const [tab, setTab] = useState<Tab>("files");
  const [selected, setSelected] = useState<string | null>(null);
  if (error) {
    return (
      <div className={d.page}>
        <Callout variant="danger">{error}</Callout>
      </div>
    );
  }
  if (!report) {
    return (
      <div className={d.page} role="status">
        {loading ? "Measuring the code…" : null}
      </div>
    );
  }
  return (
    <>
      <div className={d.page}>
        <article aria-label="Code health">
          <Lede report={report} onOpen={setSelected} />
          <Distribution report={report} />
          <TrendCard client={client} root={root} revision={revision} onOpen={setSelected} />
          <div className={s.tabs} role="tablist">
            {(["files", "issues", "folders", "map"] as Tab[]).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} className={s.tab} onClick={() => setTab(t)}>
                {t === "files" ? `Files (${report.repository.file_count})` : t === "issues" ? `Issues (${report.findings})` : t === "folders" ? "Folders" : "Map"}
              </button>
            ))}
          </div>
          {tab === "files" ? <FilesTab report={report} selected={selected} onSelect={setSelected} /> : null}
          {tab === "issues" ? <IssuesTab report={report} onSelect={setSelected} /> : null}
          {tab === "folders" ? <FoldersTab report={report} onSelect={setSelected} /> : null}
          {tab === "map" ? <HealthMap rows={report.files} selected={selected} onSelect={setSelected} /> : null}
        </article>
      </div>
      {selected ? <HealthDrawer key={selected} client={client} root={root} path={selected} revision={revision} onClose={() => setSelected(null)} onOpenFile={openFile} /> : null}
    </>
  );
}

function Lede({ report, onOpen }: { report: HealthReport; onOpen(path: string): void }) {
  const r = report.repository;
  const analysed = r.analysed_per_mille / 1000;
  return (
    <>
      <div className={s.lede}>
        <div className={s.score} aria-label="Code health score">
          <span className={s.scoreValue}>{r.average === null ? "–" : r.average.toFixed(1)}</span>
          <span className={s.scoreOf}>of 10, weighted by lines of code</span>
          {r.band ? <span className={`${s.band} ${s[r.band]}`}>{BAND_LABEL[r.band]}</span> : r.average !== null ? <span className={d.muted}>too little scored for a band</span> : null}
        </div>
        <div className={s.reads}>
          <div className={s.read}>
            <span className={s.readValue}>{r.maintainability_average?.toFixed(1) ?? "–"}</span>
            <span className={s.readLabel}>maintainability: how hard the code is to change</span>
          </div>
          <div className={s.read}>
            <span className={s.readValue}>{r.hotspot_health?.toFixed(1) ?? "–"}</span>
            <span className={s.readLabel}>{r.hotspot_count ? `hotspot health, ${r.hotspot_count} files that change most` : "no hotspots in the analysed history"}</span>
          </div>
          <div className={s.read}>
            <span className={s.readValue}>{report.findings}</span>
            <span className={s.readLabel}>open issues across {report.detectors.length} kinds</span>
          </div>
          {r.worst_file ? (
            <button type="button" className={s.read} onClick={() => onOpen(r.worst_file!.path)}>
              <span className={s.readValue}>{r.worst_file.score.toFixed(1)}</span>
              <span className={s.readLabel}>lowest: {r.worst_file.path}</span>
            </button>
          ) : null}
          <div className={s.read}>
            <span className={s.readValue}>{percent(analysed)}</span>
            <span className={s.readLabel}>
              of files scored ({report.languagesMeasured.join(", ") || "no measured language"}){r.unanalysed_count ? `; ${r.unanalysed_count} in other languages` : ""}
            </span>
          </div>
          <div className={s.read}>
            <span className={s.readValue}>
              {r.structure_average?.toFixed(1) ?? "–"} / {r.history_average?.toFixed(1) ?? "–"}
            </span>
            <span className={s.readLabel}>points lost to the code itself / to its change history</span>
          </div>
        </div>
      </div>
      <div className={s.infoRow}>
        <InfoPopover label="How scores work">
          Scores come from measured complexity, structure and change history, not from a linter: each file starts at 10 and loses points for what the detectors find, capped per kind so no single issue dominates. No model is used.
          {!report.history ? " Git history was not available, so change-history issues are not included." : ""}
        </InfoPopover>
        <InfoPopover label="Self-check">
          {report.selfCheck ? (
            <>
              {report.selfCheck.fixed_among_worst} of the {report.selfCheck.examined} lowest-scoring files were bug-fixed in the last {report.selfCheck.window_days} days, against {percent(report.selfCheck.base_rate_per_mille / 1000)} of all files ({report.selfCheck.lift.toFixed(2)}× the base rate). {report.selfCheck.note}
            </>
          ) : (
            "Self-check unavailable: it needs at least 25 scored files with history and 5 of them bug-fixed."
          )}
        </InfoPopover>
      </div>
    </>
  );
}

function Distribution({ report }: { report: HealthReport }) {
  const shares = report.repository.distribution;
  if (!report.repository.file_count) return null;
  return (
    <section className={d.section} aria-label="Distribution">
      <div className={d.bar} role="img" aria-label={shares.map((x) => `${BAND_LABEL[x.band]} ${percent(x.nloc_per_mille / 1000)}`).join(", ")}>
        {shares.map((x) => (
          <span key={x.band} className={s[`fill_${x.band}`]} style={{ width: `${x.nloc_per_mille / 10}%` }} />
        ))}
      </div>
      <div className={d.barLegend}>
        {shares.map((x) => (
          <span key={x.band}>
            <span className={`${d.swatch} ${s[`fill_${x.band}`]}`} aria-hidden />
            {BAND_LABEL[x.band]}: {x.files} files, {percent(x.nloc_per_mille / 1000)} of the code
          </span>
        ))}
      </div>
    </section>
  );
}

function FilesTab({ report, selected, onSelect }: { report: HealthReport; selected: string | null; onSelect(path: string): void }) {
  const [text, setText] = useState("");
  const [band, setBand] = useState<Band | "">("");
  const [hideTests, setHideTests] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const rows = useMemo(
    () =>
      report.files.filter(
        (r) => (!text || r.path.toLowerCase().includes(text.toLowerCase())) && (!band || r.band === band) && (!hideTests || !r.test),
      ),
    [report.files, text, band, hideTests],
  );
  return (
    <section aria-label="Files">
      <div className={d.toolbar} role="search">
        <input aria-label="Filter by path" placeholder="Filter by path" value={text} onChange={(e) => setText(e.target.value)} />
        <select aria-label="Band" value={band} onChange={(e) => setBand(e.target.value as Band | "")}>
          <option value="">All bands</option>
          {["at_risk", "needs_work", "fair", "good", "excellent"].map((b) => (
            <option key={b} value={b}>
              {BAND_LABEL[b as Band]}
            </option>
          ))}
        </select>
        <label className={d.muted}>
          <input type="checkbox" checked={hideTests} onChange={(e) => setHideTests(e.target.checked)} /> Hide tests
        </label>
        <span className={d.spacer} />
        <span className={d.muted} role="status">
          {Math.min(shown, rows.length)} of {rows.length} files, worst first
        </span>
      </div>
      <table className={d.table}>
        <thead>
          <tr>
            <th>File</th>
            <th>Health</th>
            <th className={d.num}>Maintainability</th>
            <th className={d.num}>Lines</th>
            <th>Issues</th>
            <th>Biggest issue</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, shown).map((r) => (
            <tr key={r.path} aria-selected={selected === r.path} onClick={() => onSelect(r.path)}>
              <td className={d.path} title={r.path}>
                {r.path}
                {r.hotspot ? <span className={d.chip}> hotspot</span> : null}
                {r.test ? <span className={d.chip}> test</span> : null}
              </td>
              <td>
                <BandChip score={r.defect} band={r.band} />
              </td>
              <td className={d.num}>{r.maintainability?.toFixed(1) ?? "–"}</td>
              <td className={d.num}>{compact(r.nloc)}</td>
              <td>
                <Counts counts={r.findings} />
              </td>
              <td className={d.path} title={r.topIssue ?? undefined}>
                {r.topIssue ?? ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown ? (
        <Button variant="ghost" onClick={() => setShown((n) => n + PAGE)}>
          Show more
        </Button>
      ) : null}
    </section>
  );
}

function IssuesTab({ report, onSelect }: { report: HealthReport; onSelect(path: string): void }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!report.detectors.length) return <p className={d.muted}>No detector found anything.</p>;
  return (
    <section aria-label="Issues by kind" className={d.rows}>
      {report.detectors.map((detector) => (
        <div key={detector.id} className={d.row}>
          <button type="button" className={d.link} aria-expanded={open === detector.id} onClick={() => setOpen(open === detector.id ? null : detector.id)}>
            {detectorLabel(detector.id)}
          </button>
          <span className={d.muted}>
            {totalFindings(detector.findings)} in {detector.files} files
          </span>
          <Counts counts={detector.findings} />
          <div style={{ flexBasis: "100%" }} className={d.muted}>
            {detector.summary}
          </div>
          {open === detector.id ? (
            <ul className={d.list} style={{ flexBasis: "100%" }}>
              {detector.examples.map((path) => (
                <li key={path}>
                  <button type="button" className={d.link} onClick={() => onSelect(path)}>
                    {path}
                  </button>
                </li>
              ))}
              {detector.files > detector.examples.length ? <li className={d.muted}>… {detector.files - detector.examples.length} more</li> : null}
            </ul>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function FoldersTab({ report, onSelect }: { report: HealthReport; onSelect(path: string): void }) {
  return (
    <table className={d.table} aria-label="Folders">
      <thead>
        <tr>
          <th>Folder</th>
          <th>Health</th>
          <th className={d.num}>Worst tenth</th>
          <th className={d.num}>Files</th>
          <th className={d.num}>Hotspots</th>
          <th>Lowest file</th>
        </tr>
      </thead>
      <tbody>
        {report.folders.map((f) => (
          <tr key={f.path}>
            <td>{f.path}</td>
            <td>
              <BandChip score={f.average} band={f.band} />
            </td>
            <td className={d.num}>{f.worst_decile?.toFixed(1) ?? "–"}</td>
            <td className={d.num}>
              {f.files}
              {f.unanalysed ? ` (${f.unanalysed} not scored)` : ""}
            </td>
            <td className={d.num}>{f.hotspots}</td>
            <td>
              {f.worst_file ? (
                <button type="button" className={d.link} onClick={() => onSelect(f.worst_file!.path)}>
                  {f.worst_file.path} ({f.worst_file.score.toFixed(1)})
                </button>
              ) : (
                "–"
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
