import React from "react";
import { Lightbulb } from "lucide-react";
import { processResponse } from "../../service/responseProcessingService";
import { stopNodePropagation } from "./stopPropagation";

interface SummaryBlockProps {
  summary: string;
}

/**
 * Renders the "Background Context" block containing processed summary text.
 */
export const SummaryBlock: React.FC<SummaryBlockProps> = ({ summary }) => {
  return (
    <div className="flex flex-col flex-1 min-h-0 space-y-1.5">
      <div className="text-[9px] uppercase font-bold text-[var(--color-status-warning)] font-mono tracking-wide flex-shrink-0">
        Background Context
      </div>
      <div
        className="nodrag text-[11px] font-mono text-[var(--text-normal)] leading-relaxed flex-1 min-h-0 whitespace-pre-wrap bg-[var(--color-surface-sunken)] rounded-md p-2.5 border border-[var(--border-color)]/70 w-full antialiased subpixel-antialiased select-text overflow-y-auto scrollbar-wider"
        onPointerDown={stopNodePropagation}
        onMouseDown={stopNodePropagation}
      >
        {processResponse(summary)}
      </div>
    </div>
  );
};

/**
 * Empty state placeholder shown when no summary has been generated yet.
 */
export const EmptyState: React.FC = () => {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center text-xs font-sans text-[var(--text-muted)] p-4 select-none">
      <Lightbulb
        size={24}
        className="mx-auto text-[var(--color-status-warning)] mb-2"
      />
      <span>
        Select this node to discuss tasks and build context for TaskNodes.
      </span>
    </div>
  );
};
