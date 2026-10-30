import { dashboardStyles as d } from "../../dashboard/ui";
import { BAND_LABEL, bandOf, type Band, type SeverityCounts } from "../model";
import s from "./Health.module.css";

export function BandChip({ score, band }: { score: number | null; band?: Band | null }) {
  if (score === null) return <span className={d.muted}>not scored</span>;
  const b = band ?? bandOf(score);
  return (
    <span className={`${s.band} ${s[b]}`} title={BAND_LABEL[b]}>
      {score.toFixed(1)} · {BAND_LABEL[b]}
    </span>
  );
}

export function Counts({ counts }: { counts: SeverityCounts }) {
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

export const PAGE = 200;
