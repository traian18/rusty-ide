import React from "react";
import { Eye, Gauge, Plug, ShieldCheck, Signpost, Wand2, type LucideIcon } from "lucide-react";
import { Eyebrow } from "./shared";

export const moreIntelligence: { icon: LucideIcon; title: string; text: string; experimental?: boolean }[] = [
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
