/**
 * useSidePaneState.ts
 *
 * Extracts all workspace store state selection and derived values needed by
 * the SidePane component. Keeps the main component focused on orchestration.
 */

import { useWorkspaceStore } from "../../../store";

const EMPTY_ARRAY: never[] = [];

export interface SidePaneState {
  /** The currently selected node ID from the store. */
  selectedNodeId: string | null;
  /** The currently selected node object, or undefined. */
  selectedNode: any;
  /** Execution status of the selected node. */
  nodeStatus: string;
  /** Number of chat messages for the selected node. */
  selectedChatMessageCount: number;
  /** Registered custom provider configurations. */
  customProviders: any[];
  /** ID of the active custom provider. */
  activeCustomProviderId: string | null;
  /** List of file paths modified by the selected node. */
  modifiedFiles: string[];
  /** Map of original file contents (path → content). */
  originalFileContents: Record<string, string>;
  /** Map of generated file contents (path → content). */
  generatedFileContents: Record<string, string>;
  /** The type of the selected node (e.g. "taskNode", "contextNode"). */
  nodeType: string;
  /** Storage key for persisting the pane width, scoped to node type. */
  storageKey: string;
}

/**
 * Selects and derives all store state needed by the SidePane.
 *
 * Centralises store access so the main component does not subscribe to every
 * individual store slice separately.
 */
export function useSidePaneState(): SidePaneState {
  const selectedNodeId = useWorkspaceStore((state) => state.selectedNodeId);
  const nodes = useWorkspaceStore((state) => state.nodes);
  const nodeStatus = useWorkspaceStore(
    (state) => state.nodeStatus[selectedNodeId || ""] || "idle"
  );
  const selectedChatMessageCount = useWorkspaceStore(
    (state) => state.globalChatHistory[selectedNodeId || ""]?.length || 0
  );
  const customProviders = useWorkspaceStore((state) => state.customProviders);
  const activeCustomProviderId = useWorkspaceStore(
    (state) => state.activeCustomProviderId
  );

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const modifiedFiles: string[] =
    (selectedNode?.data?.modifiedFiles as string[]) || EMPTY_ARRAY;
  const originalFileContents: Record<string, string> =
    (selectedNode?.data?.originalFileContents as Record<string, string>) || {};
  const generatedFileContents: Record<string, string> =
    (selectedNode?.data?.generatedFileContents as Record<string, string>) || {};

  const nodeType = selectedNode?.type || "default";
  const storageKey = `side_pane_width_${nodeType}`;

  return {
    selectedNodeId,
    selectedNode,
    nodeStatus,
    selectedChatMessageCount,
    customProviders,
    activeCustomProviderId,
    modifiedFiles,
    originalFileContents,
    generatedFileContents,
    nodeType,
    storageKey,
  };
}
