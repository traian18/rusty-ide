import React from "react";
import { Activity, ArrowDown, ArrowRight, Bot, CheckCircle2, Inbox, RotateCcw, Route, ShieldCheck, SlidersHorizontal, Workflow as WorkflowIcon, type LucideIcon } from "lucide-react";
import { dotted, secondaryButton, Eyebrow } from "./shared";

export const StepCard: React.FC<{
  icon: LucideIcon;
  kind: string;
  title: string;
  text: string;
  status?: "done" | "running";
  chips?: string[];
}> = ({ icon: Icon, kind, title, text, status, chips }) => (
  <div className={`overflow-hidden rounded-xl border bg-[var(--bg-sidebar)] shadow-xl ${status === "running" ? "border-[var(--border-active)]" : "border-[var(--border-color)]"}`}>
    <div className="flex items-center justify-between border-b border-[var(--border-color)] bg-[var(--color-surface-sunken)] px-3 py-2">
      <span className="flex items-center gap-2 text-[10px] font-semibold text-[var(--text-light)]">
        {status && <span className={`h-1.5 w-1.5 rounded-full ${status === "done" ? "bg-[var(--color-status-success)]" : "bg-[var(--accent-color)]"}`} />}
        <Icon size={13} className="text-[var(--accent-color)]" aria-hidden="true" /> {title}
      </span>
      <span className="text-[8px] font-mono uppercase text-[var(--text-muted)]">{kind}</span>
    </div>
    <div className="space-y-2 p-3">
      <p className="text-[9px] leading-4 text-[var(--text-normal)]">{text}</p>
      {chips && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((chip) => <span key={chip} className="rounded bg-[var(--accent-bg)] px-2 py-1 text-[8px] font-mono text-[var(--accent-color)]">{chip}</span>)}
        </div>
      )}
    </div>
  </div>
);

export const StepLink: React.FC = () => (
  <div className="flex justify-center py-1.5"><ArrowDown size={12} className="text-[var(--accent-color)]" aria-hidden="true" /></div>
);

export const WorkflowArtwork: React.FC = () => (
  <div
    className="relative overflow-hidden rounded-3xl border border-[var(--border-color)] p-6 shadow-2xl sm:p-8"
    style={{ backgroundColor: "var(--bg-canvas)", ...dotted(22) }}
  >
    <div className="absolute inset-0 bg-gradient-to-br from-[var(--accent-bg)] via-transparent to-[var(--color-status-info-bg)]/30" />
    <div className="relative mx-auto max-w-[340px]">
      <StepCard icon={Inbox} kind="Input" title="Request" text="Your message, handed to the flow." status="done" />
      <StepLink />
      <StepCard icon={Bot} kind="Agent" title="Plan" text="Read-only: explores the code and returns a concrete plan." status="done" chips={["profile · plan", "read-only tools"]} />
      <StepLink />
      <StepCard icon={Bot} kind="Agent" title="Build" text="Implements the plan, then must check its own edits before it reports." status="running" chips={["profile · build", "reads before it writes"]} />
      <div className="flex items-center justify-center gap-5 py-1.5 text-[8px] font-mono">
        <span className="flex items-center gap-1.5 text-[var(--text-muted)]"><ArrowDown size={12} className="text-[var(--accent-color)]" aria-hidden="true" /> report</span>
        <span className="flex items-center gap-1.5 text-[var(--color-status-warning)]"><RotateCcw size={11} aria-hidden="true" /> on failure · retry Build</span>
      </div>
      <StepCard icon={ShieldCheck} kind="Verify" title="Verify" text="Checks the report and that every file Build claims to have changed really exists." />
      <StepLink />
      <StepCard icon={CheckCircle2} kind="Output" title="Result" text="Summary, status, and the files changed." />
    </div>
  </div>
);

export const workflowFeatures: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Route, title: "Steps, retries, failure paths", text: "Chain input, agent, verify, and output steps. Retry a step a bounded number of times, or route a failure somewhere else." },
  { icon: SlidersHorizontal, title: "Behavior profiles", text: "Every agent step runs under a profile with its own instructions, tools, limits, and completion gate." },
  { icon: ShieldCheck, title: "Rules that steer the agent", text: "React to events such as PreToolUse: inject guidance, allow, ask, or deny a call, rewrite its arguments, or switch profiles." },
  { icon: Activity, title: "Watch every step", text: "See each step run, retry, or wait for a permission, and pause or resume the run." },
];

export const WorkflowsSection: React.FC<{ onOpenBehaviors: () => void }> = ({ onOpenBehaviors }) => (
  <section id="workflows" className="scroll-mt-16 max-w-7xl mx-auto px-6 lg:px-10 py-20 lg:py-28">
    <div className="grid items-center gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:gap-16">
      <WorkflowArtwork />

      <div>
        <Eyebrow icon={<WorkflowIcon size={13} />}>Workflow orchestration</Eyebrow>
        <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--text-light)]">Design how the work gets done.</h2>
        <p className="mt-5 text-sm leading-6 text-[var(--text-normal)]">
          A single agent loop decides its own path. A workflow decides it for the agent: which steps run, what each may use, what must be verified, and what happens on failure. New Agent chats start in Single agent mode. The built-in Plan → Build → Verify workflow is available in every workspace; choose it above the chat input when you want those steps. Open the Behaviors tab to inspect it or draw your own workflow.
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {workflowFeatures.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-xl border border-[var(--border-color)] bg-[var(--color-surface-sunken)] p-4">
              <div className="flex items-center gap-2 text-[var(--accent-color)]"><Icon size={14} aria-hidden="true" /><h3 className="text-xs font-semibold text-[var(--text-light)]">{title}</h3></div>
              <p className="mt-2 text-[10px] leading-4 text-[var(--text-muted)]">{text}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 rounded-xl border border-[var(--border-active)] bg-[var(--accent-bg)] px-4 py-3 text-[10px] leading-5 text-[var(--text-normal)]">
          Each agent step runs in a fresh, isolated session that inherits your workspace, active model, and permission policies. Edits are validated as you make them and saved as plain JSON in <code className="font-mono text-[var(--text-light)]">.rusty/workflows</code> and <code className="font-mono text-[var(--text-light)]">.rusty/profiles</code>.
        </div>

        <div className="mt-6">
          <button onClick={onOpenBehaviors} className={secondaryButton}><WorkflowIcon size={14} /> Open Behaviors <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" /></button>
        </div>
      </div>
    </div>
  </section>
);

/* -------------------------------------------------------------------------- */
/*  More built-in intelligence                                                */
/* -------------------------------------------------------------------------- */
