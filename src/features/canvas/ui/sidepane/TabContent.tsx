import React from "react";
import { useExplorerWebSocket } from "./useExplorerWebSocket";
import { type SidePaneTab } from "../../sidepane/hooks";
import { DescriptionTabContent } from "./components/DescriptionTabContent";
import { DiffTabContent } from "./components/DiffTabContent";
import { ConsoleTabContent } from "./components/ConsoleTabContent";
import { buildGlobalChatContent, buildPromptChatContent } from "./buildChatContent";

/**
 * Renders the active tab body content based on the current tab and node type.
 *
 * Each conditional branch checks both the active tab and whether the selected
 * node type supports that tab.
 */

export const TabContent: React.FC<{
  activeTab: SidePaneTab;
  selectedNode: any;
  selectedNodeId: string | null;
  tabId: string | undefined;
  modifiedFiles: string[];
  activeDiffFile: string;
  setActiveDiffFile: (file: string) => void;
  originalCode: string;
  modifiedCode: string;
  isDiffLoading: boolean;
  nodeStatus: string;
  explorer: ReturnType<typeof useExplorerWebSocket>;
  onCreateTaskNodes: (tasks: any[], contexts: any[]) => Promise<void>;
}> = (props) => {
  const {
    activeTab,
    selectedNode,
    selectedNodeId,
    tabId,
    modifiedFiles,
    activeDiffFile,
    setActiveDiffFile,
    originalCode,
    modifiedCode,
    isDiffLoading,
    nodeStatus,
    explorer,
    onCreateTaskNodes,
  } = props;

  /* Description tab — task nodes only */
  if (activeTab === "description" && selectedNode.type === "taskNode") {
    return <DescriptionTabContent selectedNode={selectedNode} tabId={tabId} />;
  }

  /* Diff tab — hidden for global chat nodes */
  if (activeTab === "diff" && selectedNode.type !== "globalChatNode") {
    return (
      <DiffTabContent
        selectedNode={selectedNode}
        modifiedFiles={modifiedFiles}
        activeDiffFile={activeDiffFile}
        setActiveDiffFile={setActiveDiffFile}
        originalCode={originalCode}
        modifiedCode={modifiedCode}
        isDiffLoading={isDiffLoading}
        tabId={tabId}
      />
    );
  }

  /* Console tab — hidden for context nodes */
  if (
    activeTab === "console" &&
    selectedNodeId &&
    selectedNode.type !== "contextNode"
  ) {
    return (
      <ConsoleTabContent selectedNodeId={selectedNodeId} tabId={tabId} />
    );
  }

  /* Chat tab — different content for global chat vs other nodes */
  if (activeTab === "chat") {
    return selectedNode.type === "globalChatNode"
      ? buildGlobalChatContent(selectedNode, nodeStatus, explorer, onCreateTaskNodes)
      : buildPromptChatContent(selectedNode, nodeStatus, explorer);
  }

  return null;
};

/* ------------------------------------------------------------------ */
/*  Render Helpers (pure functions, no hooks)                          */
/* ------------------------------------------------------------------ */
