import React from "react";

interface SectionHeaderProps {
  label: string;
  count: number;
  /** Optional action button rendered on the right side of the header. */
  action?: React.ReactNode;
}

/**
 * A labelled pill header with an optional action element.
 */
export const SectionHeader: React.FC<SectionHeaderProps> = ({ label, count, action }) => {
  return (
    <div className="px-2 py-1 flex items-center justify-between text-[10px] font-mono font-bold text-[var(--text-muted)] uppercase tracking-wider">
      <div className="flex items-center space-x-1.5">
        <span>{label}</span>
        <span className="bg-[var(--border-color)] px-1.5 py-0.2 rounded-full text-[9px] text-[var(--text-normal)]">
          {count}
        </span>
      </div>
      {action}
    </div>
  );
};
