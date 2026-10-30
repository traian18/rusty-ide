import React from "react";
import { Save } from "lucide-react";
import type { SkillsTabModel } from "./useSkillsTab";

export function SavedToast({ model }: { model: SkillsTabModel }): React.ReactElement {
  const { showSavedModal } = model;

  return (
    <>
      {showSavedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-[var(--color-surface-sunken)] backdrop-blur-sm" />
          <div className="relative bg-[var(--bg-sidebar)] border border-[var(--accent-color)]/30 rounded-xl px-6 py-4 shadow-2xl shadow-[var(--accent-color)]/10 flex items-center space-x-3">
            <div className="w-8 h-8 rounded-full bg-[var(--color-status-success-bg)] flex items-center justify-center">
              <Save size={16} className="text-[var(--color-status-success)]" />
            </div>
            <span className="text-sm font-bold text-[var(--text-light)]">Changes have been saved</span>
          </div>
        </div>
      )}
    </>
  );
}
