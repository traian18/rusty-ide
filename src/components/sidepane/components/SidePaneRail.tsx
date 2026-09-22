import React from "react";
import { Code, MessageSquare, Terminal, Folder, FileText, type LucideIcon } from "lucide-react";
import { Tooltip } from "../../ui";

export type SidePaneRailTab = "description" | "diff" | "chat" | "console" | "vfs";

interface SidePaneRailProps {
  selectedNode: any;
  activeTab: SidePaneRailTab;
  setActiveTab: (tab: SidePaneRailTab) => void;
  nodeStatus: string;
}

interface RailItem {
  id: SidePaneRailTab;
  label: string;
  icon: LucideIcon;
  show: boolean;
}

/**
 * Vertical icon rail replacing the old horizontal SidePaneTabs strip.
 *
 * The pane now opens full-screen by default (SidePane.tsx), so the section
 * switcher moved from a row of labeled tabs eating a horizontal strip at
 * the top -- fine in a narrow 500px side panel, wasteful across a full
 * window -- to a slim always-visible rail, the same pattern the app's own
 * NavigationRail already uses for its own top-level sections. Icon-only
 * with a tooltip rather than icon+label: a full-screen pane has no
 * shortage of width for content, but a labeled rail would still be wider
 * than this needs to be for five destinations.
 *
 * Placed on the pane's RIGHT edge, not the left: the pane is full-screen
 * now, so its left edge sits flush against the app's own NavigationRail
 * (the window's actual left-side icon column) -- a second icon rail there
 * reads as one overcrowded double rail. Tooltips point left accordingly.
 */
export const SidePaneRail: React.FC<SidePaneRailProps> = ({
  selectedNode,
  activeTab,
  setActiveTab,
  nodeStatus,
}) => {
  const items: RailItem[] = [
    {
      id: "description",
      label: "Description",
      icon: FileText,
      show: selectedNode.type === "taskNode",
    },
    {
      id: "diff",
      label: "VFS Diff",
      icon: Code,
      show: selectedNode.type !== "globalChatNode",
    },
    {
      id: "chat",
      label: selectedNode.type === "globalChatNode" ? "Explorer Chat" : "Chat",
      icon: MessageSquare,
      show: true,
    },
    {
      id: "console",
      label: "Console Stream",
      icon: Terminal,
      show: selectedNode.type !== "contextNode",
    },
    {
      id: "vfs",
      label: "VFS",
      icon: Folder,
      show: selectedNode.type === "taskNode" || selectedNode.type === "globalChatNode",
    },
  ];

  return (
    <div className="flex flex-col items-center w-12 flex-shrink-0 border-l border-[var(--border-color)] bg-[var(--bg-sidebar)]/40 py-3 gap-1.5">
      {items
        .filter((item) => item.show)
        .map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <Tooltip key={item.id} id={`sidepane-rail-${item.id}`} label={item.label} placement="left">
              <button
                type="button"
                onClick={() => setActiveTab(item.id)}
                aria-label={item.label}
                className={`relative flex items-center justify-center w-9 h-9 rounded-lg cursor-pointer transition-all ${
                  active
                    ? "bg-[var(--bg-app)] text-[var(--text-light)] border border-[var(--border-active)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-light)] hover:bg-[var(--bg-app)]"
                }`}
              >
                <Icon size={18} />
                {item.id === "console" && nodeStatus === "running" && (
                  <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[var(--accent-color)] animate-ping" />
                )}
              </button>
            </Tooltip>
          );
        })}
    </div>
  );
};
