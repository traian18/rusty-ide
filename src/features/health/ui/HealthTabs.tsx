import { useMemo, useState } from "react";
import { Button } from "../../../lib/ui";
import { compact } from "../../dashboard";
import { dashboardStyles as d } from "../../dashboard/ui";
import { BAND_LABEL, detectorLabel, totalFindings, type Band, type HealthReport } from "../model";
import { BandChip, Counts, PAGE } from "./healthParts";

export function FilesTab({ report, selected, onSelect }: { report: HealthReport; selected: string | null; onSelect(path: string): void }) {
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

export function IssuesTab({ report, onSelect }: { report: HealthReport; onSelect(path: string): void }) {
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

export function FoldersTab({ report, onSelect }: { report: HealthReport; onSelect(path: string): void }) {
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
