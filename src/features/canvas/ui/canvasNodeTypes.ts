import { ContextNode } from "./nodes/ContextNode";
import { TaskNode } from "./nodes/TaskNode";
import { GlobalChatNode } from "./nodes/globalChat/GlobalChatNode";
import { McpNode } from "./nodes/McpNode";
import { StickyNode } from "../nodes/sticky";
import { BoundaryNode } from "../nodes/boundary";

export const nodeTypes = {
  contextNode: ContextNode,
  taskNode: TaskNode,
  globalChatNode: GlobalChatNode,
  mcpNode: McpNode,
  stickyNode: StickyNode,
  boundaryNode: BoundaryNode,
};

export const edgeTypes = {};

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
