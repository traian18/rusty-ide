import React from "react";
import { CheckSquare, FileText, Folder, Globe, Plug, Sparkles, Square, StickyNote } from "lucide-react";
import { NodeKind } from "./guideData";

export const NodeArtwork: React.FC<{ kind: NodeKind }> = ({ kind }) => {
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
