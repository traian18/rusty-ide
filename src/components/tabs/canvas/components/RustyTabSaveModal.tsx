/**
 * RustyTabSaveModal.tsx
 *
 * Modal dialog for saving a Rusty canvas to a named file under .rusty/canvas/.
 */

import React from "react";
import { Save, X } from "lucide-react";

interface RustyTabSaveModalProps {
  /** Current title value in the input field. */
  saveTitle: string;
  /** Callback when the title input changes. */
  onTitleChange: (title: string) => void;
  /** Callback when "Cancel" or the X button is clicked. */
  onCancel: () => void;
  /** Callback when "Save Rusty" is confirmed. */
  onConfirm: () => void;
}

export const RustyTabSaveModal: React.FC<RustyTabSaveModalProps> = ({
  saveTitle,
  onTitleChange,
  onCancel,
  onConfirm,
}) => {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onConfirm();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="absolute inset-0 bg-[var(--color-surface-overlay)] backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl w-full max-w-md shadow-2xl overflow-hidden font-mono">
        {/* Header */}
        <div className="px-4 py-3 bg-[var(--bg-header)] border-b border-[var(--border-color)] flex items-center justify-between">
          <span className="text-[var(--text-light)] text-sm font-bold flex items-center space-x-2">
            <Save size={16} className="text-[var(--color-status-success)]" />
            <span>Save Rusty Canvas</span>
          </span>
          <button
            onClick={onCancel}
            className="text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 flex flex-col space-y-3">
          <p className="text-xs text-[var(--text-normal)]">
            Enter a filename/title for this Rusty. It will be serialized under{" "}
            <code className="text-[var(--color-status-success)] font-bold">
              .rusty/canvas/
            </code>
            .
          </p>
          <div className="flex flex-col space-y-1">
            <label
              htmlFor="rusty-title-input"
              className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider"
            >
              Rusty Title
            </label>
            <input
              id="rusty-title-input"
              type="text"
              value={saveTitle}
              onChange={(e) => onTitleChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. build_and_test_rusty"
              className="w-full bg-[var(--bg-canvas)] border border-[var(--border-color)] focus:border-[var(--accent-color)] text-[var(--text-light)] rounded-lg px-3 py-2 text-sm outline-none transition-colors"
              autoFocus
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-[var(--bg-header)] border-t border-[var(--border-color)] flex items-center justify-end space-x-2">
          <button
            onClick={onCancel}
            className="px-3.5 py-1.5 border border-[var(--border-color)] hover:bg-[var(--bg-canvas)] text-[var(--text-muted)] hover:text-[var(--text-light)] rounded-lg text-xs font-semibold cursor-pointer transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-1.5 bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/90 text-[var(--color-primary-foreground)] rounded-lg text-xs font-semibold cursor-pointer transition-colors shadow-md hover:shadow-lg"
          >
            Save Rusty
          </button>
        </div>
      </div>
    </div>
  );
};
