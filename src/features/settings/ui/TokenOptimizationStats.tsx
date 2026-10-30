import React from "react";
import { BarChart3 } from "lucide-react";
import { recallRate, resetTokenOptimizationStats, type FilterStats } from "../../../harness/core/tokenOptimizations";
import { useTokenOptimizationStats } from "./useTokenOptimizations";

/** Filters that pass output on unchanged, shown apart from the ones that condense. */
const PASS_THROUGH = new Set(["raw", "off", "stamped", "none"]);

const number = (value: number) => value.toLocaleString("en-US");
const percent = (value: number) => `${Math.round(value * 100)}%`;
const saved = (stats: FilterStats) => (stats.rawChars > 0 ? 1 - stats.shownChars / stats.rawChars : 0);

const cell = "px-2 py-1.5 text-right font-mono text-[11px] text-[var(--text-normal)]";
const head = "px-2 py-1.5 text-right text-[10px] font-mono font-bold uppercase text-[var(--text-muted)]";

export const TokenOptimizationStats: React.FC = () => {
  const stats = useTokenOptimizationStats();
  const rows = Object.entries(stats.filters)
    .filter(([name]) => !PASS_THROUGH.has(name))
    .sort((a, b) => b[1].rawChars - b[1].shownChars - (a[1].rawChars - a[1].shownChars));
  const total = rows.reduce((sum, [, s]) => ({ raw: sum.raw + s.rawChars, shown: sum.shown + s.shownChars }), { raw: 0, shown: 0 });

  return (
    <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-sidebar)] p-5 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-[var(--accent-bg)]/20 p-2 text-[var(--accent-color)]">
            <BarChart3 size={18} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[var(--text-light)]">What it saved</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
              Command output condensed since {new Date(stats.since).toLocaleDateString()}, by filter. <strong>Read back</strong> is
              the share of kept outputs the model asked for in full: a high rate means that filter leaves out something models need.
              {stats.refusedModelSwitches > 0 && ` The warm-cache guard kept the model ${number(stats.refusedModelSwitches)} times.`}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={resetTokenOptimizationStats}
          className="shrink-0 rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-[10px] font-mono font-bold uppercase text-[var(--text-muted)] hover:text-[var(--text-light)]"
        >
          Reset
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-[11px] text-[var(--text-muted)]">Nothing condensed yet. Statistics appear after the agent runs commands.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[var(--border-color)]">
                <th className={`${head} text-left`}>Filter</th>
                <th className={head}>Runs</th>
                <th className={head}>Chars in</th>
                <th className={head}>Chars out</th>
                <th className={head}>Saved</th>
                <th className={head}>Kept</th>
                <th className={head}>Read back</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([name, s]) => {
                const rate = recallRate(s);
                return (
                  <tr key={name} className="border-b border-[var(--border-color)]/50">
                    <td className={`${cell} text-left`}>{name}</td>
                    <td className={cell}>{number(s.runs)}</td>
                    <td className={cell}>{number(s.rawChars)}</td>
                    <td className={cell}>{number(s.shownChars)}</td>
                    <td className={cell}>{percent(saved(s))}</td>
                    <td className={cell}>{number(s.stored)}</td>
                    <td className={cell}>{rate === undefined ? "-" : percent(rate)}</td>
                  </tr>
                );
              })}
              <tr>
                <td className={`${cell} text-left font-bold`}>All</td>
                <td className={cell} colSpan={3}>{number(total.raw)} {"->"} {number(total.shown)}</td>
                <td className={`${cell} font-bold`}>{percent(total.raw > 0 ? 1 - total.shown / total.raw : 0)}</td>
                <td className={cell} colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
