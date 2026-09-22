/**
 * ConflictsTabContent Component
 * 
 * Displays the static analysis summary of conflict details and provides instructions
 * to the user on how they can proceed with resolving the differences.
 */

import React from "react";

interface ConflictsTabContentProps {
  conflictDetails: string;
}

export const ConflictsTabContent: React.FC<ConflictsTabContentProps> = ({
  conflictDetails
}) => {
  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <div className="bg-[var(--color-status-danger-bg)] border border-[var(--color-status-danger-border)] rounded-xl p-4">
        <div className="text-[10px] uppercase font-bold text-[var(--color-status-danger)] font-mono mb-2">
          Conflict Analysis
        </div>
        <pre className="text-xs font-sans text-[var(--text-normal)] whitespace-pre-wrap leading-relaxed">
          {conflictDetails}
        </pre>
      </div>

      <div className="text-[10px] text-[var(--text-muted)] font-sans">
        <strong>How to resolve:</strong> Use the "Resolve Chat" tab to ask the AI to analyze and fix conflicts, or review the "Diff View" to manually check changes. Once satisfied, click "Approve Reconciliation" below.
      </div>
    </div>
  );
};
