import React from "react";
import { Folder, Globe, Sparkles } from "lucide-react";

export const HeroGraph: React.FC = () => (
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
