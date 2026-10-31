import React from "react";
import { cacheHitRate, type PromptCacheStats as Stats } from "../../../harness/core/tokenOptimizations";

const number = (value: number) => value.toLocaleString("en-US");

const CAUSES: { key: keyof Stats["misses"]; label: string; hint: string }[] = [
  { key: "prefix", label: "Prompt or tools changed", hint: "the system prompt or tool list differed from the run's previous request" },
  { key: "expired", label: "Cache expired", hint: "more than five minutes passed since the previous request" },
  { key: "history", label: "History rewritten", hint: "earlier turns changed (compaction, trimming, replaced reads) or the provider dropped the cache" },
];

/** How well model requests reused the prompt cache, and why the ones that missed did. */
export const PromptCacheStats: React.FC<{ stats: Stats }> = ({ stats }) => {
  if (stats.requests === 0) {
    return <p className="text-[11px] text-[var(--text-muted)]">No model requests measured yet. Prompt cache statistics appear after the agent runs.</p>;
  }
  const rate = cacheHitRate(stats);
  return (
    <div className="space-y-2">
      <h4 className="text-[10px] font-mono font-bold uppercase text-[var(--text-muted)]">Prompt cache</h4>
      <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
        {number(stats.requests)} requests, {number(stats.followUps)} of them follow-ups that could reuse the previous prompt.{" "}
        {rate === undefined ? "No provider reported cache reads yet." : <>Hit rate <strong className="text-[var(--text-light)]">{Math.round(rate * 100)}%</strong>.</>}{" "}
        {number(stats.cacheRead)} tokens read from the cache, {number(stats.cacheWrite)} written to it.
        {stats.unreported > 0 && ` ${number(stats.unreported)} follow-ups came from providers that report no cache use.`}
      </p>
      <ul className="space-y-1">
        {CAUSES.map(({ key, label, hint }) => (
          <li key={key} className="flex justify-between gap-4 text-[11px]" title={hint}>
            <span className="text-[var(--text-normal)]">{label}</span>
            <span className="font-mono text-[var(--text-normal)]">{number(stats.misses[key])} missed</span>
          </li>
        ))}
      </ul>
    </div>
  );
};
