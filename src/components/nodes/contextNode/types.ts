/**
 * Core types for the ContextNode component and its sub-components.
 *
 * ContextNodeData represents the mutable data payload attached to a
 * React Flow node of type "contextNode".
 */

import type { SearchMatch } from "../../../services/searchService";

/** Data stored on the React Flow node for a context node. */
export interface ContextNodeData {
  name?: string;
  path?: string;
  fileName?: string;
  isDir?: boolean;
  description?: string;
  isMinimized?: boolean;
}

/** Props received by the ContextNode component from React Flow. */
export interface ContextNodeProps {
  id: string;
  data: ContextNodeData;
}

/** Internal state for the file search overlay. */
export interface SearchOverlayState {
  show: boolean;
  query: string;
  results: SearchMatch[];
  isSearching: boolean;
  selectedIndex: number;
}
