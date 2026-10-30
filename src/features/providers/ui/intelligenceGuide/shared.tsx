import React from "react";

export const dotted = (size: number): React.CSSProperties => ({
  backgroundImage: "radial-gradient(circle, var(--border-color) 1px, transparent 1px)",
  backgroundSize: `${size}px ${size}px`,
});

export const secondaryButton =
  "group inline-flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--color-surface-elevated)] px-5 py-3 text-xs font-mono font-semibold text-[var(--text-light)] hover:border-[var(--border-active)] transition-colors cursor-pointer";

export const Eyebrow: React.FC<{ icon?: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <div className="inline-flex items-center gap-2 text-[9px] font-mono uppercase tracking-[0.2em] text-[var(--accent-color)] mb-4">{icon}{children}</div>
);

/** Three bars, `level` of them filled: how demanding a request is. */
export const LevelMeter: React.FC<{ level: 1 | 2 | 3 }> = ({ level }) => (
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
