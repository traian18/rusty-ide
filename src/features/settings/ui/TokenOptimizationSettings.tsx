import React from "react";
import { History, Layers, Repeat, Scissors, ShieldCheck, Undo2, Zap, type LucideIcon } from "lucide-react";
import {
  SAFEGUARDS,
  TOKEN_OPTIMIZATIONS,
  setOptimizationEnabled,
  type OptimizationId,
  type TokenOptimization,
} from "../../../harness/core/tokenOptimizations";
import { TokenOptimizationStats } from "./TokenOptimizationStats";
import { useOptimizationSwitches } from "./useTokenOptimizations";

const ICONS: Record<OptimizationId, LucideIcon> = {
  "command-output": Layers,
  recall: Undo2,
  "repeat-results": Repeat,
  "tool-output-limits": Scissors,
  "stable-history": History,
  "warm-cache-guard": Zap,
};

const card = "rounded-2xl border border-[var(--border-color)] bg-[var(--bg-sidebar)] p-5 shadow-sm space-y-3";

const OptimizationCard: React.FC<{ optimization: TokenOptimization; enabled: boolean }> = ({ optimization, enabled }) => {
  const Icon = ICONS[optimization.id];
  const inputId = `token-optimization-${optimization.id}`;
  return (
    <section className={card} aria-labelledby={`${inputId}-title`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-[var(--accent-bg)]/20 p-2 text-[var(--accent-color)]">
            <Icon size={18} />
          </div>
          <div>
            <h3 id={`${inputId}-title`} className="text-sm font-bold text-[var(--text-light)]">{optimization.name}</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-normal)]">{optimization.summary}</p>
          </div>
        </div>
        <label htmlFor={inputId} className="flex shrink-0 items-center gap-2 text-[10px] font-mono font-bold uppercase text-[var(--text-muted)]">
          <input
            id={inputId}
            type="checkbox"
            checked={enabled}
            onChange={(event) => setOptimizationEnabled(optimization.id, event.target.checked)}
            className="h-4 w-4 accent-[var(--accent-color)]"
          />
          Enabled
        </label>
      </div>
      <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">{optimization.details}</p>
      <p className="text-[10px] font-mono text-[var(--text-muted)]">Acts on: {optimization.actsOn}</p>
    </section>
  );
};

const Safeguards: React.FC = () => (
  <section className={card}>
    <div className="flex items-start gap-3">
      <div className="rounded-xl bg-[var(--accent-bg)]/20 p-2 text-[var(--accent-color)]">
        <ShieldCheck size={18} />
      </div>
      <div>
        <h3 className="text-sm font-bold text-[var(--text-light)]">Safeguards</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">Always on: they are what makes the optimisations above safe to leave on.</p>
      </div>
    </div>
    <ul className="space-y-1.5 pl-1">
      {SAFEGUARDS.map((safeguard) => (
        <li key={safeguard.name} className="text-[11px] leading-relaxed text-[var(--text-normal)]">
          <strong className="text-[var(--text-light)]">{safeguard.name}.</strong> {safeguard.summary}
        </li>
      ))}
    </ul>
  </section>
);

/** Settings → Token optimisations: one switch per optimisation, the safeguards, and what they saved. */
export const TokenOptimizationSettings: React.FC = () => {
  const switches = useOptimizationSwitches();
  return (
    <div className="space-y-4">
      <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
        Rusty sends models fewer tokens by condensing what tools print before the model reads it, and by keeping the prompt cache warm.
        Nothing a model needs to act is left out for good: condensed output can always be read back in full. Changes apply from the next command.
      </p>
      {TOKEN_OPTIMIZATIONS.map((optimization) => (
        <OptimizationCard key={optimization.id} optimization={optimization} enabled={switches[optimization.id]} />
      ))}
      <Safeguards />
      <TokenOptimizationStats />
    </div>
  );
};
