import React from "react";
import { CheckCircle2, FileSearch, Globe, ScanSearch, Settings, Sparkles, type LucideIcon } from "lucide-react";
import { secondaryButton, Eyebrow } from "./shared";

export const MockShell: React.FC<{ tool: string; tag: string; children: React.ReactNode }> = ({ tool, tag, children }) => (
  <div className="overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-sidebar)] font-mono">
    <div className="flex items-center justify-between border-b border-[var(--border-color)] bg-[var(--color-surface-sunken)] px-3 py-2 text-[9px]">
      <span className="text-[var(--text-light)]">{tool}</span>
      <span className="text-[8px] uppercase text-[var(--text-muted)]">{tag}</span>
    </div>
    <div className="space-y-2 p-3 text-[9px]">{children}</div>
  </div>
);

export const ReadMock: React.FC = () => (
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

export const SearchMock: React.FC = () => (
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

export const WebMock: React.FC = () => (
  <MockShell tool="web_extract" tag="verbatim">
    <div className="text-[var(--text-muted)]">“How long do access tokens last?”</div>
    <div className="rounded-md border-l-2 border-[var(--accent-color)] bg-[var(--color-surface-sunken)] px-2.5 py-2 leading-4 text-[var(--text-light)]">“Access tokens expire after 15 minutes.”</div>
    <div className="text-[8px] text-[var(--text-muted)]">Source: docs.example.com/auth/tokens</div>
  </MockShell>
);

export interface SmartToolCard {
  icon: LucideIcon;
  title: string;
  tool: string;
  description: string;
  mock: React.ReactNode;
  points: string[];
}

export const smartTools: SmartToolCard[] = [
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
