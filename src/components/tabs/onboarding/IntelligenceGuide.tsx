import React from "react";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronDown,
  Cpu,
  Eye,
  FileSearch,
  Gauge,
  Globe,
  Inbox,
  Plug,
  RotateCcw,
  Route,
  ScanSearch,
  Settings,
  ShieldCheck,
  Signpost,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Wand2,
  Workflow as WorkflowIcon,
  type LucideIcon,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Shared pieces                                                             */
/* -------------------------------------------------------------------------- */

const dotted = (size: number): React.CSSProperties => ({
  backgroundImage: "radial-gradient(circle, var(--border-color) 1px, transparent 1px)",
  backgroundSize: `${size}px ${size}px`,
});

const secondaryButton =
  "group inline-flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--color-surface-elevated)] px-5 py-3 text-xs font-mono font-semibold text-[var(--text-light)] hover:border-[var(--border-active)] transition-colors cursor-pointer";

const Eyebrow: React.FC<{ icon?: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <div className="inline-flex items-center gap-2 text-[9px] font-mono uppercase tracking-[0.2em] text-[var(--accent-color)] mb-4">{icon}{children}</div>
);

/** Three bars, `level` of them filled: how demanding a request is. */
const LevelMeter: React.FC<{ level: 1 | 2 | 3 }> = ({ level }) => (
  <span className="inline-flex items-end gap-0.5" aria-hidden="true">
    {[1, 2, 3].map((step) => (
      <span
        key={step}
        className={`w-1.5 rounded-sm ${step <= level ? "bg-[var(--accent-color)]" : "bg-[var(--border-color)]"}`}
        style={{ height: 4 + step * 3 }}
      />
    ))}
  </span>
);

/** The three AUTO levels; the criteria paraphrase what Settings shows for each. */
const levels = [
  { level: 1 as const, name: "Light", model: "Fast model", criteria: "Conversation, factual questions, explaining code, and small single-file edits." },
  { level: 2 as const, name: "Standard", model: "Balanced model", criteria: "Features and bug fixes across a few files, tests, reviews, and debugging with a clear error." },
  { level: 3 as const, name: "Heavy", model: "Frontier model", criteria: "Architecture, large refactors, subtle concurrency or performance bugs, and long multi-step tasks." },
];

/* -------------------------------------------------------------------------- */
/*  Hero visual                                                               */
/* -------------------------------------------------------------------------- */

const routedRequests = [
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

const autoSteps = [
  ["01", "Choose AUTO in the Agent model picker", "Turn on Intelligent model selection once and AUTO appears beside your other models."],
  ["02", "A decision model rates the request", "JEV rates it Light, Standard, or Heavy. It never sees your model list, so your mapping alone decides what runs."],
  ["03", "Your model for that level runs it", "When JEV is unsure and leans higher, AUTO steps up one level. Under-powering a request costs more than over-paying."],
];

const TraceCard: React.FC<{
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

const MockShell: React.FC<{ tool: string; tag: string; children: React.ReactNode }> = ({ tool, tag, children }) => (
  <div className="overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-sidebar)] font-mono">
    <div className="flex items-center justify-between border-b border-[var(--border-color)] bg-[var(--color-surface-sunken)] px-3 py-2 text-[9px]">
      <span className="text-[var(--text-light)]">{tool}</span>
      <span className="text-[8px] uppercase text-[var(--text-muted)]">{tag}</span>
    </div>
    <div className="space-y-2 p-3 text-[9px]">{children}</div>
  </div>
);

const ReadMock: React.FC = () => (
  <MockShell tool="token.service.ts" tag="1,204 lines">
    <div className="text-[var(--text-muted)]">“How are refresh tokens revoked?”</div>
    {[["verifyRefreshToken", "L88–121"], ["revokeSession", "L240–262"]].map(([name, range]) => (
      <div key={name} className="flex items-center justify-between rounded-md bg-[var(--accent-bg)] px-2 py-1.5">
        <span className="text-[var(--text-light)]">{name}</span><span className="text-[var(--accent-color)]">{range}</span>
      </div>
    ))}
    <div className="text-[8px] text-[var(--text-muted)]">1,147 lines not sent to the model</div>
  </MockShell>
);

const SearchMock: React.FC = () => (
  <MockShell tool="search_codebase" tag="ranked">
    <div className="text-[var(--text-muted)]">“Where are sessions revoked?”</div>
    {[["1", "session.service.ts:57"], ["2", "token.service.ts:13"], ["3", "logout.controller.ts:22"]].map(([rank, location]) => (
      <div key={rank} className="flex items-center gap-2 rounded-md bg-[var(--color-surface-sunken)] px-2 py-1.5">
        <span className="text-[var(--accent-color)]">{rank}</span><span className="text-[var(--text-light)]">{location}</span>
      </div>
    ))}
    <div className="text-[8px] text-[var(--text-muted)]">Top 3 of 41 matches</div>
  </MockShell>
);

const WebMock: React.FC = () => (
  <MockShell tool="web_extract" tag="verbatim">
    <div className="text-[var(--text-muted)]">“How long do access tokens last?”</div>
    <div className="rounded-md border-l-2 border-[var(--accent-color)] bg-[var(--color-surface-sunken)] px-2.5 py-2 leading-4 text-[var(--text-light)]">“Access tokens expire after 15 minutes.”</div>
    <div className="text-[8px] text-[var(--text-muted)]">Source: docs.example.com/auth/tokens</div>
  </MockShell>
);

interface SmartToolCard {
  icon: LucideIcon;
  title: string;
  tool: string;
  description: string;
  mock: React.ReactNode;
  points: string[];
}

const smartTools: SmartToolCard[] = [
  {
    icon: FileSearch,
    title: "Smart file reading",
    tool: "read_file",
    description: "Returns only the portions of a file that answer your request, instead of the whole file.",
    mock: <ReadMock />,
    points: ["A selector model chooses the relevant sections", "Large files no longer flood the context"],
  },
  {
    icon: ScanSearch,
    title: "Smart code search",
    tool: "search_codebase",
    description: "Finds the best matches for a need you describe and returns a ranked, size-limited list of file locations.",
    mock: <SearchMock />,
    points: ["Describe the need in plain language", "Results are ranked and capped in size"],
  },
  {
    icon: Globe,
    title: "Smart web extraction",
    tool: "web_extract",
    description: "Returns only the sections of a web page that answer a question, quoted verbatim with the source URL.",
    mock: <WebMock />,
    points: ["Every quote carries its source", "Full-page web_fetch stays available"],
  },
];

export const SmartToolsSection: React.FC<{ onOpenSettings: () => void }> = ({ onOpenSettings }) => (
  <section id="smart-tools" className="scroll-mt-16 border-y border-[var(--border-color)] bg-[var(--color-surface-sunken)]">
    <div className="max-w-7xl mx-auto px-6 lg:px-10 py-20 lg:py-28">
      <div className="max-w-3xl">
        <Eyebrow icon={<Sparkles size={13} />}>Smart tools</Eyebrow>
        <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--text-light)]">Read less. Understand more.</h2>
        <p className="mt-5 text-sm leading-6 text-[var(--text-normal)]">
          Whole files, raw search dumps, and full web pages bury the answer. Smart tools use a selector model you choose to hand the agent only what answers the question, so its context stays focused on the work.
        </p>
      </div>

      <div className="mt-12 grid gap-4 lg:grid-cols-3">
        {smartTools.map(({ icon: Icon, title, tool, description, mock, points }) => (
          <article key={tool} className="group flex flex-col rounded-2xl border border-[var(--border-color)] bg-[var(--bg-editor)] p-6 transition-colors hover:border-[var(--border-active)]">
            <div className="flex items-center justify-between">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--color-surface-sunken)] text-[var(--accent-color)] transition-colors group-hover:border-[var(--border-active)]"><Icon size={16} /></span>
              <code className="rounded border border-[var(--border-color)] bg-[var(--color-surface-sunken)] px-2 py-1 text-[9px] font-mono text-[var(--text-muted)]">{tool}</code>
            </div>
            <h3 className="mt-6 text-lg font-semibold text-[var(--text-light)]">{title}</h3>
            <p className="mt-3 text-xs leading-5 text-[var(--text-normal)]">{description}</p>
            <div className="mt-5">{mock}</div>
            <ul className="mt-auto space-y-2 pt-5">
              {points.map((point) => (
                <li key={point} className="flex items-start gap-2 text-[10px] leading-4 text-[var(--text-muted)]"><CheckCircle2 size={12} className="mt-0.5 flex-shrink-0 text-[var(--color-status-success)]" />{point}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>

      <div className="mt-5 flex flex-col gap-5 rounded-2xl border border-[var(--border-active)] bg-[var(--accent-bg)] px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-3xl">
          <div className="text-xs font-semibold text-[var(--text-light)]">Opt in, then pick a selector.</div>
          <p className="mt-1.5 text-[10px] leading-5 text-[var(--text-normal)]">
            Each tool stays off until you enable it in Settings → Intelligence and choose its selector provider and model. That choice is captured when a run starts and holds until the run finishes. Smart tools work in Agent chats and Canvas tasks.
          </p>
        </div>
        <button onClick={onOpenSettings} className={`${secondaryButton} flex-shrink-0`}><Settings size={14} /> Open Settings</button>
      </div>
    </div>
  </section>
);

/* -------------------------------------------------------------------------- */
/*  Workflow orchestration                                                    */
/* -------------------------------------------------------------------------- */

const StepCard: React.FC<{
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

const StepLink: React.FC = () => (
  <div className="flex justify-center py-1.5"><ArrowDown size={12} className="text-[var(--accent-color)]" aria-hidden="true" /></div>
);

const WorkflowArtwork: React.FC = () => (
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

const workflowFeatures: { icon: LucideIcon; title: string; text: string }[] = [
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

const moreIntelligence: { icon: LucideIcon; title: string; text: string; experimental?: boolean }[] = [
  { icon: Wand2, title: "Skills", text: "A skill defines how the model works: its system instructions, tools, preferred model, and MCP access. Configure it once in the Skills tab, then apply it consistently." },
  { icon: ShieldCheck, title: "Risk review", experimental: true, text: "Before an agent destructively overwrites a file or runs a destructive command, JEV reviews the step. It can let it run, send the agent back to revise, or ask you." },
  { icon: Signpost, title: "JEV decisions", experimental: true, text: "Agents lay out the options and JEV picks one. In AUTO chats it can also move a chat up to a stronger model when the remaining work needs it." },
  { icon: Eye, title: "Tool Execution Observability", text: "Inspect every tool call, including which model ran it and the raw request and response behind each JEV decision." },
  { icon: Plug, title: "MCP integration", text: "Connect MCP servers for documentation, services, and project systems, then give skills and canvas tasks access to them." },
  { icon: Gauge, title: "Token Metrics", text: "Follow your daily token usage in the Token Metrics tab and see how your model choices add up." },
];

export const MoreIntelligenceSection: React.FC = () => (
  <section id="more" className="scroll-mt-16 max-w-7xl mx-auto px-6 lg:px-10 py-20 lg:py-28">
    <div className="max-w-3xl">
      <Eyebrow>Also built in</Eyebrow>
      <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--text-light)]">Guardrails and visibility around every run.</h2>
      <p className="mt-5 text-sm leading-6 text-[var(--text-normal)]">The same intelligence that picks models and trims context also keeps agents in bounds and shows you what they did.</p>
    </div>

    <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {moreIntelligence.map(({ icon: Icon, title, text, experimental }) => (
        <article key={title} className="group rounded-2xl border border-[var(--border-color)] bg-[var(--color-surface-sunken)] p-6 transition-colors hover:border-[var(--border-active)]">
          <div className="flex items-center justify-between">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-editor)] text-[var(--accent-color)] transition-colors group-hover:border-[var(--border-active)]"><Icon size={16} /></span>
            {experimental && <span className="rounded border border-[var(--border-color)] px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-wider text-[var(--text-muted)]">Experimental</span>}
          </div>
          <h3 className="mt-5 text-sm font-semibold text-[var(--text-light)]">{title}</h3>
          <p className="mt-2.5 text-xs leading-5 text-[var(--text-muted)]">{text}</p>
        </article>
      ))}
    </div>
  </section>
);
