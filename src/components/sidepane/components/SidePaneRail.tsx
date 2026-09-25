import React from "react";
import { Code, MessageSquare, Terminal, FileText, type LucideIcon } from "lucide-react";
import { Tooltip } from "../../ui";

export type SidePaneRailTab = "description" | "diff" | "chat" | "console";

interface SidePaneRailProps {
  selectedNode: any;
  activeTab: SidePaneRailTab;
  setActiveTab: (tab: SidePaneRailTab) => void;
  nodeStatus: string;
}

interface RailItem { id: SidePaneRailTab; label: string; icon: LucideIcon; show: boolean; }

/** Node-local chat, history, and change inspection rail. VFS browsing is temporarily disabled. */
export const SidePaneRail: React.FC<SidePaneRailProps> = ({ selectedNode, activeTab, setActiveTab, nodeStatus }) => {
  const items: RailItem[] = [
    { id: "description", label: "Description", icon: FileText, show: selectedNode.type === "taskNode" },
    { id: "diff", label: "Changes", icon: Code, show: selectedNode.type !== "globalChatNode" },
    { id: "chat", label: selectedNode.type === "globalChatNode" ? "Explorer Chat" : "Chat", icon: MessageSquare, show: true },
    { id: "console", label: "Console Stream", icon: Terminal, show: selectedNode.type !== "contextNode" },
  ];
  return <div className="flex flex-col items-center w-12 flex-shrink-0 border-l border-[var(--border-color)] bg-[var(--bg-sidebar)]/40 py-3 gap-1.5">
    {items.filter((item) => item.show).map((item) => {
      const Icon = item.icon;
      return <Tooltip key={item.id} id={`sidepane-rail-${item.id}`} label={item.label} placement="left"><button id={`sidepane-rail-${item.id}-btn`} type="button" onClick={() => setActiveTab(item.id)} aria-label={item.label} className={`relative flex items-center justify-center w-9 h-9 rounded-lg cursor-pointer transition-all ${activeTab === item.id ? "bg-[var(--bg-app)] text-[var(--text-light)] border border-[var(--border-active)]" : "text-[var(--text-muted)] hover:text-[var(--text-light)] hover:bg-[var(--bg-app)]"}`}><Icon size={18} />{item.id === "console" && nodeStatus === "running" && <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[var(--accent-color)] animate-ping" />}</button></Tooltip>;
    })}
  </div>;
};
