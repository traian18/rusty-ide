import React from "react";
import { CheckCircle2, ChevronDown, Cpu, Settings, TrendingUp } from "lucide-react";
import { secondaryButton, Eyebrow, LevelMeter } from "./shared";
import { levels } from "./HeroIntelligence";

export const autoSteps = [
  ["01", "Choose AUTO in the Agent model picker", "Turn on Intelligent model selection once and AUTO appears beside your other models."],
  ["02", "A decision model rates the request", "JEV rates it Light, Standard, or Heavy. It never sees your model list, so your mapping alone decides what runs."],
  ["03", "Your model for that level runs it", "When JEV is unsure and leans higher, AUTO steps up one level. Under-powering a request costs more than over-paying."],
];

export const TraceCard: React.FC<{
  request: string;
  scores: [number, number, number];
  confidence: number;
  outcome: string;
  escalated?: boolean;
}> = ({ request, scores, confidence, outcome, escalated }) => {
  const best = Math.max(...scores);
  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-editor)] p-4">
      <div className="text-[10px] leading-4 text-[var(--text-light)]">{request}</div>
      <div className="mt-3 space-y-1.5">
        {levels.map((level, index) => (
          <div key={level.name} className="grid grid-cols-[54px_1fr_30px] items-center gap-2 text-[8px] font-mono text-[var(--text-muted)]">
            <span>{level.name}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-[var(--border-color)]">
              <span
                className={`block h-full rounded-full ${scores[index] === best ? "bg-[var(--accent-color)]" : "bg-[var(--text-muted)] opacity-50"}`}
                style={{ width: `${scores[index]}%` }}
              />
            </span>
            <span className="text-right">{scores[index]}%</span>
          </div>
        ))}
      </div>
      <div className={`mt-3 flex items-start gap-2 border-t border-[var(--border-color)] pt-3 text-[9px] leading-4 ${escalated ? "text-[var(--color-status-warning)]" : "text-[var(--color-status-success)]"}`}>
        {escalated ? <TrendingUp size={12} className="mt-0.5 flex-shrink-0" aria-hidden="true" /> : <CheckCircle2 size={12} className="mt-0.5 flex-shrink-0" aria-hidden="true" />}
        <span><strong>Confidence {confidence}%.</strong> {outcome}</span>
      </div>
    </div>
  );
};

export const AutoModelSection: React.FC<{ onOpenSettings: () => void }> = ({ onOpenSettings }) => (
  <section id="auto-model" className="scroll-mt-16 max-w-7xl mx-auto px-6 lg:px-10 py-20 lg:py-28">
    <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-12 lg:gap-16 items-start">
      <div>
        <Eyebrow icon={<Cpu size={13} />}>Automatic model selection</Eyebrow>
        <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--text-light)]">Every request gets the model it needs.</h2>
        <p className="mt-5 text-sm leading-6 text-[var(--text-normal)]">
          Stop choosing a model for every message. Rusty rates how demanding each request is and runs it on the model you assigned to that level, so quick questions stay fast and cheap while hard problems get real horsepower.
        </p>

        <div className="mt-8 space-y-3">
          {autoSteps.map(([number, title, text]) => (
            <div key={number} className="grid grid-cols-[32px_1fr] gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--color-surface-sunken)] p-4">
              <span className="text-[9px] font-mono text-[var(--accent-color)] pt-0.5">{number}</span>
              <div><h3 className="text-xs font-semibold text-[var(--text-light)]">{title}</h3><p className="mt-1.5 text-[10px] leading-4 text-[var(--text-muted)]">{text}</p></div>
            </div>
          ))}
        </div>

        <div className="mt-5 rounded-xl border border-[var(--border-active)] bg-[var(--accent-bg)] px-4 py-3 text-[10px] leading-5 text-[var(--text-normal)]">
          <span className="font-semibold text-[var(--text-light)]">You define the mapping.</span> Assign any model from any connected provider to each level, reasoning-effort variants included. Every decision is recorded in Tool Execution Observability: the request, the probabilities, the confidence, the model chosen, and what the decision cost.
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button onClick={onOpenSettings} className={secondaryButton}><Settings size={14} /> Open Settings</button>
          <p className="max-w-xs text-[9px] font-mono leading-4 text-[var(--text-muted)]">Settings → Intelligence. Needs an OpenRouter API key with a JEV Decisions model in its model book.</p>
        </div>
      </div>

      <div>
        <div className="rounded-3xl border border-[var(--border-color)] bg-[var(--color-surface-sunken)] p-6 lg:p-7">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[9px] font-mono uppercase tracking-[0.18em] text-[var(--text-muted)]">Model per level</span>
            <span className="text-[8px] font-mono uppercase text-[var(--text-muted)]">You choose each one</span>
          </div>
          <ol className="mt-5 space-y-3">
            {levels.map(({ level, name, model, criteria }) => (
              <li key={name} className="grid gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-editor)] p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                <div>
                  <div className="flex items-center gap-2"><LevelMeter level={level} /><span className="text-xs font-semibold text-[var(--text-light)]">{name}</span></div>
                  <p className="mt-2 text-[10px] leading-4 text-[var(--text-muted)]">{criteria}</p>
                </div>
                <span className="inline-flex min-w-[150px] items-center justify-between gap-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-app)] px-3 py-2 text-[10px] font-mono text-[var(--text-normal)]">
                  {model}<ChevronDown size={12} className="text-[var(--text-muted)]" aria-hidden="true" />
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-4 rounded-3xl border border-[var(--border-color)] bg-[var(--color-surface-sunken)] p-6 lg:p-7">
          <span className="text-[9px] font-mono uppercase tracking-[0.18em] text-[var(--text-muted)]">What a decision looks like</span>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <TraceCard request="Add rate limiting to the public API" scores={[4, 71, 25]} confidence={71} outcome="Runs on Standard." />
            <TraceCard request="Untangle a flaky test in the job queue" scores={[10, 46, 44]} confidence={46} outcome="Below 60% and leaning higher, so AUTO steps up to Heavy." escalated />
          </div>
        </div>
      </div>
    </div>
  </section>
);

/* -------------------------------------------------------------------------- */
/*  Smart tools                                                               */
/* -------------------------------------------------------------------------- */
