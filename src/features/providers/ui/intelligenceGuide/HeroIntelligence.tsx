import React from "react";
import {ArrowRight, FileSearch, Sparkles, Workflow as WorkflowIcon} from "lucide-react";
import { dotted, LevelMeter } from "./shared";

/** The three AUTO levels; the criteria paraphrase what Settings shows for each. */
export const levels = [
  { level: 1 as const, name: "Light", model: "Fast model", criteria: "Conversation, factual questions, explaining code, and small single-file edits." },
  { level: 2 as const, name: "Standard", model: "Balanced model", criteria: "Features and bug fixes across a few files, tests, reviews, and debugging with a clear error." },
  { level: 3 as const, name: "Heavy", model: "Frontier model", criteria: "Architecture, large refactors, subtle concurrency or performance bugs, and long multi-step tasks." },
];

/* -------------------------------------------------------------------------- */
/*  Hero visual                                                               */
/* -------------------------------------------------------------------------- */

export const routedRequests = [
  { request: "Fix the typo in the setup guide", level: levels[0], confidence: 94 },
  { request: "Add rate limiting to the public API", level: levels[1], confidence: 81 },
  { request: "Design session storage for multi-region failover", level: levels[2], confidence: 88 },
];

export const HeroIntelligence: React.FC = () => (
  <div
    className="relative min-h-[380px] rounded-3xl border border-[var(--border-color)] overflow-hidden shadow-2xl p-5 sm:p-7"
    style={{ backgroundColor: "var(--bg-canvas)", ...dotted(22) }}
  >
    <div className="absolute inset-0 bg-gradient-to-br from-[var(--accent-bg)] via-transparent to-[var(--color-status-info-bg)]/30" />
    <div className="relative flex h-full min-h-[320px] flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2 rounded-full border border-[var(--border-active)] bg-[var(--accent-bg)] px-3 py-1.5 text-[9px] font-mono font-bold uppercase tracking-[0.16em] text-[var(--accent-color)]"><Sparkles size={12} /> Auto</span>
        <span className="text-[8px] font-mono uppercase tracking-wider text-[var(--text-muted)]">Rated per request</span>
      </div>

      {routedRequests.map(({ request, level, confidence }) => (
        <div key={request} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-sidebar)] p-3.5 shadow-xl">
          <div className="text-[10px] leading-4 text-[var(--text-light)]">{request}</div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[8px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
              <LevelMeter level={level.level} />
              <span className="font-bold text-[var(--text-normal)]">{level.name}</span>
              <span>· {confidence}%</span>
            </div>
            <div className="flex items-center gap-2">
              <ArrowRight size={12} className="text-[var(--accent-color)]" aria-hidden="true" />
              <span className="rounded-md border border-[var(--border-color)] bg-[var(--color-surface-sunken)] px-2 py-1 text-[9px] font-mono text-[var(--text-normal)]">{level.model}</span>
            </div>
          </div>
        </div>
      ))}

      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-sidebar)]/90 px-3 py-1.5 text-[8px] font-mono text-[var(--text-muted)] shadow-lg"><FileSearch size={11} className="text-[var(--accent-color)]" /> Smart read · 3 relevant sections</span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-sidebar)]/90 px-3 py-1.5 text-[8px] font-mono text-[var(--text-muted)] shadow-lg"><WorkflowIcon size={11} className="text-[var(--accent-color)]" /> Plan → Build → Verify</span>
      </div>
    </div>
  </div>
);

/* -------------------------------------------------------------------------- */
/*  Automatic model selection                                                 */
/* -------------------------------------------------------------------------- */
