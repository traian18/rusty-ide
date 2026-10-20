import { useMemo } from "react";

import { Button } from "../components/ui";
import d from "../dashboard/Dashboard.module.css";
import { useLoad } from "../dashboard/useLoad";
import type { HealthClient } from "./client";
import type { TrendPoint, TrendView } from "./model";
import s from "./Health.module.css";

const WIDTH = 240;
const HEIGHT = 48;
/// Fewer rebuilt points than this and the card offers to build the history.
const ENOUGH_HISTORY = 3;

function signed(value: number | null): string {
  if (value === null) return "–";
  if (Math.abs(value) < 0.05) return "no change";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function when(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** A line through the points' maintainability, scaled to the range they cover. */
export function Sparkline({ points }: { points: TrendPoint[] }) {
  const path = useMemo(() => {
    const values = points.map((p) => p.maintainability).filter((v): v is number => v !== null);
    if (values.length < 2) return null;
    const lo = Math.min(...values) - 0.2;
    const hi = Math.max(...values) + 0.2;
    const xs = points.filter((p) => p.maintainability !== null);
    const first = xs[0].at_ms;
    const span = Math.max(1, xs[xs.length - 1].at_ms - first);
    return xs
      .map((p) => {
        const x = ((p.at_ms - first) / span) * (WIDTH - 4) + 2;
        const y = HEIGHT - 2 - (((p.maintainability as number) - lo) / (hi - lo)) * (HEIGHT - 4);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [points]);
  if (!path) return <span className={d.muted}>Not enough points for a line yet.</span>;
  return (
    <svg className={s.sparkline} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Maintainability over time">
      <polyline points={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export interface TrendCardProps {
  client: HealthClient;
  root: string;
  revision: number;
  onOpen(path: string): void;
}

/** How maintainability has moved: a line, the change, the files that moved most, and a way to rebuild history. */
export function TrendCard({ client, root, revision, onOpen }: TrendCardProps) {
  const { value: trend } = useLoad<TrendView>(() => client.trend(root), [client, root, revision]);
  if (!trend) return null;
  const latest = trend.points[trend.points.length - 1];
  const regressions = [...trend.points].reverse().find((p) => !p.backfilled)?.regressions ?? [];
  return (
    <section className={d.section} aria-label="Trend">
      <div className={s.trend}>
        <div className={s.trendHead}>
          <strong>Trend</strong>
          <span className={d.muted}>
            {latest ? `${trend.points.length} points, ${when(trend.points[0].at_ms)} to ${when(latest.at_ms)}` : "no points yet"}
          </span>
        </div>
        <Sparkline points={trend.points} />
        <div className={s.trendReads}>
          <span>
            maintainability {latest?.maintainability?.toFixed(1) ?? "–"} ({trend.direction})
          </span>
          <span title="Against the previous point">since last: {signed(trend.changeSincePrevious)}</span>
          <span title="Against about 30 days earlier">30 days: {signed(trend.change30Days)}</span>
        </div>
        {regressions.length ? (
          <div className={s.trendMovers}>
            <span className={d.muted}>fell since the last analysis:</span>
            {regressions.slice(0, 3).map((m) => (
              <button key={m.path} type="button" className={s.mover} onClick={() => onOpen(m.path)}>
                {m.path} {m.from.toFixed(1)} → {m.to.toFixed(1)}
              </button>
            ))}
          </div>
        ) : null}
        {trend.backfilled < ENOUGH_HISTORY ? (
          <div className={s.trendBuild}>
            <span className={d.muted}>Re-score past commits to see the trend from the start.</span>
            <Button onClick={() => void client.buildHistory(root)}>Build history</Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
