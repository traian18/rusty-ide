/**
 * EdgeInspectorTabs Component
 * 
 * Renders the tab navigation bar inside the Edge Inspector Pane, allowing users
 * to switch between "Conflicts" summary, "Diff View", and the conflict resolution "Resolve Chat".
 */

import React from "react";
import { AlertTriangle, Code, MessageSquare } from "lucide-react";

interface EdgeInspectorTabsProps {
  activeTab: "conflicts" | "diff" | "chat";
  setActiveTab: (tab: "conflicts" | "diff" | "chat") => void;
}

export const EdgeInspectorTabs: React.FC<EdgeInspectorTabsProps> = ({
  activeTab,
  setActiveTab
}) => {
  return (
    <div className="flex border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/10 text-xs font-mono flex-shrink-0 select-none">
      <button
        onClick={() => setActiveTab("conflicts")}
        className={`flex items-center space-x-1.5 px-4 py-2.5 border-b-2 transition-all ${
          activeTab === "conflicts"
            ? "border-[var(--color-status-danger-border)] text-[var(--text-light)] bg-[var(--color-status-danger-bg)] font-semibold"
            : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-light)]"
        }`}
      >
        <AlertTriangle size={14} />
        <span>Conflicts</span>
      </button>
      <button
        onClick={() => setActiveTab("diff")}
        className={`flex items-center space-x-1.5 px-4 py-2.5 border-b-2 transition-all ${
          activeTab === "diff"
            ? "border-[var(--color-status-danger-border)] text-[var(--text-light)] bg-[var(--color-status-danger-bg)] font-semibold"
            : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-light)]"
        }`}
      >
        <Code size={14} />
        <span>Diff View</span>
      </button>
      <button
        onClick={() => setActiveTab("chat")}
        className={`flex items-center space-x-1.5 px-4 py-2.5 border-b-2 transition-all ${
          activeTab === "chat"
            ? "border-[var(--color-status-danger-border)] text-[var(--text-light)] bg-[var(--color-status-danger-bg)] font-semibold"
            : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-light)]"
        }`}
      >
        <MessageSquare size={14} />
        <span>Resolve Chat</span>
      </button>
    </div>
  );
};
