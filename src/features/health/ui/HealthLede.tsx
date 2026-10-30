import { percent } from "../../dashboard";
import { dashboardStyles as d } from "../../dashboard/ui";
import { InfoPopover } from "./InfoPopover";
import { BAND_LABEL, type HealthReport } from "../model";
import s from "./Health.module.css";

export function Lede({ report, onOpen }: { report: HealthReport; onOpen(path: string): void }) {
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

export function Distribution({ report }: { report: HealthReport }) {
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
