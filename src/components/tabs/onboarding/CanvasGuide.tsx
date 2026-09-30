import React from "react";
import {
  ArrowRight,
  CheckCircle2,
  CheckSquare,
  FileText,
  FlaskConical,
  Folder,
  GitMerge,
  Globe,
  MessageSquare,
  Play,
  Plug,
  Sparkles,
  Square,
  StickyNote,
} from "lucide-react";
import { RustyIcon } from "../../RustyIcon";
import { BetaBadge } from "./BetaBadge";

type NodeKind = "global" | "task" | "context" | "mcp" | "sticky" | "boundary";

interface NodeGuide {
  kind: NodeKind;
  title: string;
  eyebrow: string;
  description: string;
  details: string[];
}

const nodeGuides: NodeGuide[] = [
  {
    kind: "global",
    title: "Global Explorer",
    eyebrow: "Plan the Rusty",
    description: "The reasoning center for this canvas. Give it your feature brief, explore the codebase, and generate an editable graph of tasks and supporting context.",
    details: ["One per Rusty", "Generates task and context nodes", "Uses the model and skill you select"],
  },
  {
    kind: "task",
    title: "Task Node",
    eyebrow: "Implement one bounded change",
    description: "A focused unit of execution. It receives only its connected context and upstream work, then writes its result into an isolated virtual workspace for review.",
    details: ["Choose a model per task", "Inspect the diff before integration", "Iterate through the node chat"],
  },
  {
    kind: "context",
    title: "Context Node",
    eyebrow: "Control what the model sees",
    description: "Attach a file, folder, or written instruction to the tasks that need it. Explicit context keeps generations grounded and makes their inputs visible to you.",
    details: ["Search or drag in project files", "Add architectural guidance", "Connect it only where relevant"],
  },
  {
    kind: "mcp",
    title: "MCP Node",
    eyebrow: "Bring in external knowledge",
    description: "Connect a configured MCP server to a task when implementation depends on information outside the repository, such as documentation, services, or project systems.",
    details: ["Select a configured server", "Describe what should be fetched", "Share the result with connected tasks"],
  },
  {
    kind: "sticky",
    title: "Sticky Note",
    eyebrow: "Keep human reasoning visible",
    description: "Record an assumption, question, decision, or reminder directly beside the work it concerns. Sticky notes never execute and never spend tokens.",
    details: ["Capture discoveries as you iterate", "Document decisions in place", "Use colors to build your own visual language"],
  },
  {
    kind: "boundary",
    title: "Boundary",
    eyebrow: "Give a large graph structure",
    description: "Group related work into a named visual area. Boundaries make large Rustys navigable without changing execution or forcing an artificial hierarchy.",
    details: ["Group a concern or subsystem", "Jump between named regions", "Keep 100+ node canvases legible"],
  },
];

const workflow = [
  {
    icon: MessageSquare,
    number: "01",
    phase: "Discover",
    title: "Explore the feature",
    text: "Begin in a normal chat. Investigate the existing code, compare approaches, and turn a vague request into a decision you are prepared to implement.",
    actions: ["Choose the model that fits the difficulty of the discussion.", "Use Inline Chat when a selected line or file needs focused explanation.", "Identify constraints, existing contracts, risks, and unresolved questions."],
    ready: "You can explain the desired behavior and what is out of scope.",
  },
  {
    icon: FileText,
    number: "02",
    phase: "Discover",
    title: "Capture the brief",
    text: "Extract the useful result of that conversation into a Markdown file. The brief is durable project context—not knowledge trapped inside chat history.",
    actions: ["Record the objective, contracts, acceptance criteria, and important decisions.", "Keep the brief in the repository so both you and future models can inspect it."],
    ready: "The Markdown file is specific enough to review without the original chat.",
  },
  {
    icon: Globe,
    number: "03",
    phase: "Build",
    title: "Generate the graph",
    text: "Open a Rusty, attach the brief, and ask the Global Explorer to propose an implementation graph. The proposal is a starting point, not an order to execute.",
    actions: ["Review task boundaries and connect the files or guidance each task needs.", "Add, remove, split, or reorder nodes until the graph matches your understanding."],
    ready: "Every task has a bounded purpose, relevant context, and sensible dependencies.",
  },
  {
    icon: Play,
    number: "04",
    phase: "Build",
    title: "Iterate node by node",
    text: "Work one bounded task at a time. Select its model and skill, run it, inspect the generated files and diff, then use the node chat to correct or deepen the result.",
    actions: ["Add context when the model guessed, duplicated behavior, or missed a contract.", "Rerun and review until you understand why each change belongs in the codebase."],
    ready: "You can explain the change, the contract it uses, and how it was verified.",
  },
  {
    icon: GitMerge,
    number: "05",
    phase: "Integrate",
    title: "Reconcile convergence",
    text: "Independent tasks may converge on the same file. Open reconciliation to compare their intended changes and compose one coherent implementation.",
    actions: ["Treat files touched by several nodes as integration hotspots, not ordinary diffs.", "Use a stronger model only when collision complexity actually requires it."],
    ready: "Overlapping work preserves every required behavior without duplicate implementations.",
  },
  {
    icon: CheckCircle2,
    number: "06",
    phase: "Integrate",
    title: "Review and merge",
    text: "Review the Rusty as a whole, apply its virtual changes to the real workspace, and use Git as the final integration boundary.",
    actions: ["Inspect the combined diff and run the relevant tests and checks.", "Merge only when the implementation still matches the Markdown brief."],
    ready: "The code is coherent, verified, and understandable enough for you to maintain.",
  },
];

const NodeArtwork: React.FC<{ kind: NodeKind }> = ({ kind }) => {
  const commonCard = "relative w-[230px] rounded-lg border bg-[var(--bg-sidebar)] shadow-xl overflow-hidden";

  if (kind === "global") {
    return (
      <div className={`${commonCard} border-[var(--color-status-danger-border)]`}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] bg-[var(--color-surface-sunken)]">
          <span className="flex items-center gap-2 text-[10px] font-semibold text-[var(--text-light)]"><Globe size={13} className="text-[var(--color-status-danger)]" /> Global Explorer</span>
          <span className="text-[8px] font-mono text-[var(--text-muted)]">PLAN</span>
        </div>
        <div className="p-3 space-y-2">
          <div className="text-[9px] leading-relaxed text-[var(--text-normal)] bg-[var(--color-surface-sunken)] rounded-md p-2 border border-[var(--border-color)]">Turn the security brief into bounded, connected tasks.</div>
          <div className="flex gap-1.5">
            <span className="px-2 py-1 rounded bg-[var(--accent-bg)] text-[8px] font-mono text-[var(--accent-color)]">AUDITOR</span>
            <span className="px-2 py-1 rounded bg-[var(--color-surface-elevated)] text-[8px] font-mono text-[var(--text-muted)]">MODEL</span>
          </div>
        </div>
      </div>
    );
  }

  if (kind === "task") {
    return (
      <div className={`${commonCard} border-[var(--border-active)]`}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] bg-[var(--color-surface-sunken)]">
          <span className="flex items-center gap-2 text-[10px] font-semibold text-[var(--text-light)]"><Sparkles size={13} className="text-[var(--accent-color)]" /> Harden JWT validation</span>
          <span className="w-2 h-2 rounded-full bg-[var(--color-status-success)]" />
        </div>
        <div className="p-3">
          <div className="text-[8px] font-mono uppercase text-[var(--text-muted)] mb-1.5">Prompt instructions</div>
          <div className="text-[9px] leading-relaxed text-[var(--text-normal)] bg-[var(--color-surface-sunken)] rounded-md p-2 border border-[var(--border-color)]">Reuse the existing token contract and add expiry checks.</div>
        </div>
        <div className="flex justify-between px-3 py-1.5 border-t border-[var(--border-color)] text-[8px] font-mono text-[var(--text-muted)]"><span>OPEN PANE</span><span>LOCAL MODEL</span></div>
      </div>
    );
  }

  if (kind === "context") {
    return (
      <div className={`${commonCard} border-[var(--color-status-success-border)]`}>
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-color)] bg-[var(--color-surface-sunken)] text-[10px] font-semibold text-[var(--text-light)]">
          <Folder size={13} className="text-[var(--color-status-success)]" /> JWT contract
        </div>
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-2 px-2 py-2 rounded-md border border-[var(--border-color)] bg-[var(--color-surface-sunken)]">
            <FileText size={14} className="text-[var(--accent-color)]" />
            <div><div className="text-[9px] text-[var(--text-light)]">token.service.ts</div><div className="text-[8px] font-mono text-[var(--text-muted)]">src/auth/</div></div>
          </div>
          <p className="text-[8px] leading-relaxed text-[var(--text-muted)]">Preserve the current claims shape and error contract.</p>
        </div>
      </div>
    );
  }

  if (kind === "mcp") {
    return (
      <div className={`${commonCard} border-[var(--color-status-info-border)]`}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] bg-[var(--color-surface-sunken)]">
          <span className="flex items-center gap-2 text-[10px] font-semibold text-[var(--text-light)]"><Plug size={13} className="text-[var(--color-status-info)]" /> Security documentation</span>
          <span className="text-[8px] font-mono text-[var(--color-status-info)]">MCP</span>
        </div>
        <div className="p-3 space-y-2">
          <div className="text-[8px] font-mono uppercase text-[var(--text-muted)]">Connected server</div>
          <div className="rounded-md p-2 border border-[var(--border-color)] bg-[var(--color-surface-sunken)] text-[9px] text-[var(--text-normal)]">Project Knowledge Base</div>
          <p className="text-[8px] leading-relaxed text-[var(--text-muted)]">Fetch the current authentication requirements.</p>
        </div>
      </div>
    );
  }

  if (kind === "sticky") {
    return (
      <div className="relative w-[210px] min-h-[145px] rotate-[-2deg] rounded-md border border-[var(--color-status-warning-border)] bg-[var(--color-status-warning-bg)] shadow-xl p-4">
        <div className="flex items-center justify-between mb-3 text-[var(--color-status-warning)]"><StickyNote size={15} /><span className="text-[8px] font-mono">DECISION</span></div>
        <p className="text-[11px] leading-relaxed text-[var(--text-light)]">All controllers must use the shared authorization guard.</p>
        <div className="absolute bottom-3 left-4 right-4 h-px bg-[var(--color-status-warning-border)]" />
      </div>
    );
  }

  return (
    <div className="relative w-[250px] h-[160px] rounded-xl border-2 border-dashed border-[var(--color-status-danger-border)] bg-[var(--color-status-danger-bg)]/20 p-3">
      <div className="flex items-center gap-2 text-[10px] font-semibold text-[var(--color-status-danger)]"><Square size={13} /> Authentication</div>
      <div className="absolute left-5 right-5 top-12 bottom-5 grid grid-cols-2 gap-2">
        <div className="rounded border border-[var(--border-color)] bg-[var(--bg-sidebar)] flex items-center justify-center"><Folder size={15} className="text-[var(--color-status-success)]" /></div>
        <div className="rounded border border-[var(--border-active)] bg-[var(--bg-sidebar)] flex items-center justify-center"><CheckSquare size={15} className="text-[var(--accent-color)]" /></div>
      </div>
    </div>
  );
};

const HeroGraph: React.FC = () => (
  <div
    className="relative h-[360px] rounded-3xl border border-[var(--border-color)] overflow-hidden shadow-2xl"
    style={{
      backgroundColor: "var(--bg-canvas)",
      backgroundImage: "radial-gradient(circle, var(--border-color) 1px, transparent 1px)",
      backgroundSize: "22px 22px",
    }}
  >
    <div className="absolute inset-0 bg-gradient-to-br from-[var(--accent-bg)] via-transparent to-[var(--color-status-info-bg)]/30" />
    <svg className="absolute inset-0 w-full h-full" aria-hidden="true">
      <path d="M145 112 C 220 112, 205 250, 292 250" fill="none" stroke="var(--color-status-success)" strokeWidth="2" strokeDasharray="6 6" opacity="0.65" />
      <path d="M302 112 C 360 112, 350 250, 400 250" fill="none" stroke="var(--accent-color)" strokeWidth="2.5" opacity="0.8" />
      <path d="M330 250 L 375 250" fill="none" stroke="var(--accent-color)" strokeWidth="2.5" opacity="0.8" />
    </svg>

    <div className="absolute left-[7%] top-[18%] w-[142px] rounded-lg border border-[var(--color-status-success-border)] bg-[var(--bg-sidebar)] shadow-xl overflow-hidden">
      <div className="px-2.5 py-2 border-b border-[var(--border-color)] flex items-center gap-2 text-[9px] font-semibold text-[var(--text-light)]"><Folder size={12} className="text-[var(--color-status-success)]" /> Feature brief</div>
      <div className="p-2.5 text-[8px] font-mono text-[var(--text-muted)]">security-update.md</div>
    </div>

    <div className="absolute left-[38%] top-[13%] w-[154px] rounded-lg border border-[var(--color-status-danger-border)] bg-[var(--bg-sidebar)] shadow-xl overflow-hidden">
      <div className="px-2.5 py-2 border-b border-[var(--border-color)] flex items-center gap-2 text-[9px] font-semibold text-[var(--text-light)]"><Globe size={12} className="text-[var(--color-status-danger)]" /> Global Explorer</div>
      <div className="p-2.5 text-[8px] text-[var(--text-muted)]">Generate the implementation graph</div>
    </div>

    <div className="absolute left-[24%] bottom-[14%] w-[155px] rounded-lg border border-[var(--border-active)] bg-[var(--bg-sidebar)] shadow-xl overflow-hidden">
      <div className="px-2.5 py-2 border-b border-[var(--border-color)] flex items-center gap-2 text-[9px] font-semibold text-[var(--text-light)]"><Sparkles size={12} className="text-[var(--accent-color)]" /> JWT handling</div>
      <div className="p-2.5 text-[8px] text-[var(--text-muted)]">Reuse the existing contract</div>
    </div>

    <div className="absolute right-[7%] bottom-[14%] w-[155px] rounded-lg border border-[var(--border-active)] bg-[var(--bg-sidebar)] shadow-xl overflow-hidden">
      <div className="px-2.5 py-2 border-b border-[var(--border-color)] flex items-center gap-2 text-[9px] font-semibold text-[var(--text-light)]"><Sparkles size={12} className="text-[var(--accent-color)]" /> Rate limiting</div>
      <div className="p-2.5 text-[8px] text-[var(--text-muted)]">Apply policy at the boundary</div>
    </div>

    <div className="absolute left-5 bottom-5 flex items-center gap-2 rounded-full border border-[var(--border-color)] bg-[var(--bg-sidebar)]/90 px-3 py-1.5 text-[8px] font-mono text-[var(--text-muted)] shadow-lg">
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-status-success)]" /> CONTEXT IS EXPLICIT
    </div>
  </div>
);

interface CanvasGuideProps {
  hasWorkspace: boolean;
  onOpenCanvas: () => void;
}

/**
 * Everything about Rusty Canvas, kept together because the canvas is in beta:
 * one place to mark, trim, or rewrite as the feature changes.
 */
export const CanvasGuide: React.FC<CanvasGuideProps> = ({ hasWorkspace, onOpenCanvas }) => (
  <>
    <section id="canvas" className="scroll-mt-16 border-y border-[var(--border-color)] bg-[var(--color-surface-sunken)]">
      <div className="max-w-7xl mx-auto px-6 lg:px-10 py-20 lg:py-28">
        <div className="grid lg:grid-cols-[1.02fr_0.98fr] gap-12 lg:gap-16 items-center">
          <div>
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <span className="inline-flex items-center gap-2 text-[9px] font-mono uppercase tracking-[0.2em] text-[var(--accent-color)]"><RustyIcon size={14} /> Rusty Canvas</span>
              <BetaBadge />
            </div>
            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--text-light)]">Plan visually.<br />Execute in bounded steps.</h2>
            <p className="mt-5 max-w-xl text-sm leading-6 text-[var(--text-normal)]">
              The canvas turns a feature brief into explicit context, bounded tasks, and inspectable changes. Tasks share Rusty&rsquo;s smart tools and skills, and you pick a model for each one.
            </p>
            <div className="mt-6 max-w-xl flex items-start gap-3 rounded-xl border border-[var(--color-status-warning-border)] bg-[var(--color-status-warning-bg)] px-4 py-3">
              <FlaskConical size={16} className="mt-0.5 flex-shrink-0 text-[var(--color-status-warning)]" aria-hidden="true" />
              <div>
                <div className="text-xs font-semibold text-[var(--text-light)]">The canvas is in beta.</div>
                <p className="mt-1 text-[11px] leading-5 text-[var(--text-normal)]">We are actively reworking it, so expect its layout and behavior to change between releases.</p>
              </div>
            </div>
            <button onClick={onOpenCanvas} className="group mt-7 inline-flex items-center gap-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--color-surface-elevated)] px-5 py-3 text-xs font-mono font-semibold text-[var(--text-light)] hover:border-[var(--border-active)] transition-colors cursor-pointer">
              {hasWorkspace ? "Try the Code Canvas" : "Choose a workspace first"}
              <BetaBadge size="sm" />
              <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
          <HeroGraph />
        </div>
      </div>
    </section>

    <section id="canvas-loop" className="scroll-mt-16 max-w-7xl mx-auto px-6 lg:px-10 py-20 lg:py-28">
      <div className="max-w-3xl">
        <div className="flex items-center gap-3 text-[9px] font-mono uppercase tracking-[0.2em] text-[var(--accent-color)] mb-4">Canvas · A repeatable loop <BetaBadge size="sm" /></div>
        <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--text-light)]">From conversation to understood code.</h2>
        <p className="mt-5 text-sm leading-6 text-[var(--text-normal)]">A Rusty is the middle of the process—not the beginning and not the final authority. Start by deciding what should exist, use the canvas to implement it deliberately, and finish at a Git boundary.</p>
      </div>

      <div className="mt-10 grid md:grid-cols-3 gap-3">
        {[
          ["Discover", "01–02", "Decide what to build and preserve the reasoning in a reviewable brief."],
          ["Build", "03–04", "Turn intent into a graph, then learn through small execution and review loops."],
          ["Integrate", "05–06", "Resolve converging changes, verify the whole, and cross the Git boundary."],
        ].map(([title, range, text], index) => (
          <div key={title} className="relative rounded-2xl border border-[var(--border-color)] bg-[var(--color-surface-sunken)] p-5">
            <div className="flex items-center justify-between"><span className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-[var(--accent-color)]">{title}</span><span className="text-[9px] font-mono text-[var(--text-muted)]">{range}</span></div>
            <p className="mt-3 text-[11px] leading-5 text-[var(--text-muted)]">{text}</p>
            {index < 2 && <ArrowRight size={14} className="hidden md:block absolute -right-[9px] top-1/2 z-10 text-[var(--accent-color)]" />}
          </div>
        ))}
      </div>

      <div className="mt-5 grid lg:grid-cols-2 gap-4">
        {workflow.map(({ icon: Icon, number, phase, title, text, actions, ready }) => (
          <article key={number} className="relative rounded-2xl border border-[var(--border-color)] bg-[var(--bg-editor)] p-6 lg:p-7 min-h-[340px] group hover:border-[var(--border-active)] transition-colors">
            <div className="flex items-center justify-between">
              <span className="w-9 h-9 rounded-lg border border-[var(--border-color)] bg-[var(--color-surface-sunken)] flex items-center justify-center text-[var(--accent-color)] group-hover:border-[var(--border-active)] transition-colors"><Icon size={16} /></span>
              <div className="flex items-center gap-3"><span className="text-[8px] font-mono uppercase tracking-widest text-[var(--text-muted)]">{phase}</span><span className="text-[9px] font-mono text-[var(--accent-color)]">{number}</span></div>
            </div>
            <h3 className="mt-7 text-lg font-semibold text-[var(--text-light)]">{title}</h3>
            <p className="mt-3 text-xs leading-5 text-[var(--text-normal)]">{text}</p>
            <div className="mt-5">
              <div className="text-[8px] font-mono uppercase tracking-[0.16em] text-[var(--text-muted)] mb-2.5">What you do</div>
              <ul className="space-y-2">
                {actions.map((action) => (
                  <li key={action} className="flex items-start gap-2 text-[10px] leading-4 text-[var(--text-muted)]"><span className="mt-[6px] w-1 h-1 rounded-full bg-[var(--accent-color)] flex-shrink-0" />{action}</li>
                ))}
              </ul>
            </div>
            <div className="mt-6 pt-4 border-t border-[var(--border-color)] flex items-start gap-3">
              <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0 text-[var(--color-status-success)]" />
              <div><div className="text-[8px] font-mono uppercase tracking-[0.16em] text-[var(--color-status-success)]">Ready when</div><p className="mt-1.5 text-[10px] leading-4 text-[var(--text-normal)]">{ready}</p></div>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-5 rounded-2xl border border-[var(--border-active)] bg-[var(--accent-bg)] p-6 lg:p-8 grid lg:grid-cols-[0.75fr_1.25fr] gap-8 items-center">
        <div>
          <div className="text-[9px] font-mono uppercase tracking-[0.18em] text-[var(--accent-color)] mb-3">Iteration is the point</div>
          <h3 className="text-xl font-semibold text-[var(--text-light)]">A failed first result is information.</h3>
          <p className="mt-3 text-xs leading-5 text-[var(--text-normal)]">Do not compensate with a larger prompt or blindly accept a plausible diff. Find what the task lacked, make that context explicit, and run the bounded loop again.</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {["Inspect the diff", "Find the missing context", "Adjust the task", "Run and verify again"].map((label, index) => (
            <div key={label} className="relative min-h-24 rounded-xl border border-[var(--border-color)] bg-[var(--bg-editor)] p-3 flex flex-col justify-between">
              <span className="text-[8px] font-mono text-[var(--accent-color)]">0{index + 1}</span>
              <span className="text-[10px] leading-4 font-semibold text-[var(--text-light)]">{label}</span>
              {index < 3 && <ArrowRight size={12} className="hidden sm:block absolute -right-[7px] top-1/2 z-10 text-[var(--accent-color)]" />}
            </div>
          ))}
        </div>
      </div>
    </section>

    <section id="nodes" className="scroll-mt-16 border-y border-[var(--border-color)] bg-[var(--color-surface-sunken)]">
      <div className="max-w-7xl mx-auto px-6 lg:px-10 py-20 lg:py-28">
        <div className="max-w-2xl">
          <div className="flex items-center gap-3 text-[9px] font-mono uppercase tracking-[0.2em] text-[var(--accent-color)] mb-4">Canvas · Meet the nodes <BetaBadge size="sm" /></div>
          <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--text-light)]">Each shape has one responsibility.</h2>
          <p className="mt-5 text-sm leading-6 text-[var(--text-normal)]">Nodes keep planning, evidence, execution, and human notes separate. Edges make their relationships explicit.</p>
        </div>

        <div className="mt-14 space-y-5">
          {nodeGuides.map((node, index) => (
            <article key={node.kind} className="grid lg:grid-cols-[0.85fr_1.15fr] min-h-[310px] rounded-3xl border border-[var(--border-color)] bg-[var(--bg-editor)] overflow-hidden">
              <div
                className={`relative min-h-[260px] flex items-center justify-center p-8 border-b lg:border-b-0 ${index % 2 === 0 ? "lg:border-r" : "lg:border-l lg:order-2"} border-[var(--border-color)]`}
                style={{ backgroundImage: "radial-gradient(circle, var(--border-color) 1px, transparent 1px)", backgroundSize: "20px 20px" }}
              >
                <div className="absolute inset-0 bg-[var(--accent-bg)] opacity-20" />
                <div className="relative scale-105 sm:scale-110"><NodeArtwork kind={node.kind} /></div>
              </div>
              <div className={`p-8 lg:p-12 flex flex-col justify-center ${index % 2 === 0 ? "" : "lg:order-1"}`}>
                <div className="text-[9px] font-mono uppercase tracking-[0.18em] text-[var(--accent-color)]">{node.eyebrow}</div>
                <h3 className="mt-3 text-2xl font-semibold text-[var(--text-light)]">{node.title}</h3>
                <p className="mt-4 max-w-xl text-sm leading-6 text-[var(--text-normal)]">{node.description}</p>
                <ul className="mt-6 grid sm:grid-cols-3 gap-3">
                  {node.details.map((detail) => (
                    <li key={detail} className="flex items-start gap-2 text-[10px] leading-4 text-[var(--text-muted)]"><CheckCircle2 size={12} className="mt-0.5 flex-shrink-0 text-[var(--color-status-success)]" />{detail}</li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-8 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-editor)] p-6 lg:p-8 grid lg:grid-cols-[0.7fr_1.3fr] gap-8 items-center">
          <div>
            <div className="text-[9px] font-mono uppercase tracking-[0.18em] text-[var(--accent-color)] mb-3">Reading the graph</div>
            <h3 className="text-xl font-semibold text-[var(--text-light)]">Edges describe the flow of evidence and work.</h3>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            {[
              ["Context → Task", "The task receives a file, folder, instruction, or MCP result."],
              ["Task → Task", "The downstream task builds on files produced upstream."],
              ["Many → One file", "A reconciliation point: inspect and compose overlapping intent."],
            ].map(([title, text]) => (
              <div key={title} className="rounded-xl border border-[var(--border-color)] bg-[var(--color-surface-sunken)] p-4"><div className="text-[10px] font-mono font-bold text-[var(--text-light)]">{title}</div><div className="mt-2 text-[10px] leading-4 text-[var(--text-muted)]">{text}</div></div>
            ))}
          </div>
        </div>
      </div>
    </section>
  </>
);
