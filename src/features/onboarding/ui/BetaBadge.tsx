import React from "react";
import { FlaskConical } from "lucide-react";

interface BetaBadgeProps {
  /** `sm` sits inline beside nav labels, eyebrows and buttons; `md` stands alone. */
  size?: "sm" | "md";
  className?: string;
}

/** Marks Rusty Canvas as beta wherever the guide mentions it. */
export const BetaBadge: React.FC<BetaBadgeProps> = ({ size = "md", className = "" }) => {
  const small = size === "sm";
  return (
    <span
      title="Rusty Canvas is in beta and is changing quickly"
      className={`inline-flex items-center gap-1 rounded-full border border-[var(--color-status-warning-border)] bg-[var(--color-status-warning-bg)] font-mono font-bold uppercase text-[var(--color-status-warning)] ${small ? "px-1.5 py-0.5 text-[8px] tracking-[0.12em]" : "px-2.5 py-1 text-[9px] tracking-[0.16em]"} ${className}`}
    >
      <FlaskConical size={small ? 10 : 12} aria-hidden="true" />
      Beta
    </span>
  );
};
