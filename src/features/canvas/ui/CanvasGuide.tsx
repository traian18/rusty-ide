import React from "react";
import {ArrowRight, CheckCircle2, FlaskConical} from "lucide-react";
import { RustyIcon } from "../../../app/RustyIcon";
import { nodeGuides, workflow } from "./canvasGuide/guideData";
import { NodeArtwork } from "./canvasGuide/NodeArtwork";
import { HeroGraph } from "./canvasGuide/HeroGraph";
import { BetaBadge } from "../../onboarding/ui";

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
