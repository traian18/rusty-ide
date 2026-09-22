import { Node, Edge, Connection } from "@xyflow/react";

export const canvasGraphHelper = {
  isValidConnection: (connection: Connection, nodes: Node[]): boolean => {
    const { source, target, sourceHandle, targetHandle } = connection;
    if (source === target) return false;

    const sourceNode = nodes.find((n) => n.id === source);
    const targetNode = nodes.find((n) => n.id === target);
    if (!sourceNode || !targetNode) return false;

    // Context nodes are not allowed to be connected to other ContextNodes
    if (sourceNode.type === "contextNode" && targetNode.type === "contextNode") {
      return false;
    }

    if (sourceNode.type === "contextNode" || sourceNode.type === "mcpNode") {
      // Context and MCP nodes may fan out, but can only feed task context handles.
      if (targetNode.type !== "taskNode" || !targetHandle?.startsWith("context-in")) {
        return false;
      }
    }

    // Enforce target logic for task nodes
    if (sourceNode.type === "taskNode" && targetNode.type === "taskNode") {
      if (sourceHandle !== "task-out" || targetHandle !== "task-in") {
        return false;
      }
    }

    return true;
  },

  getCanvasCenter: (rfInstance: any): { x: number; y: number } => {
    if (rfInstance) {
      const reactFlowBounds = document.getElementById("rf-canvas")?.getBoundingClientRect();
      if (reactFlowBounds) {
        const x = reactFlowBounds.left + reactFlowBounds.width / 2;
        const y = reactFlowBounds.top + reactFlowBounds.height / 2;
        return rfInstance.screenToFlowPosition({ x, y });
      }
    }
    return { x: 300, y: 200 };
  },

  styleEdges: (edges: Edge[]): Edge[] => {
    return edges.map((edge) => {
      if (edge.sourceHandle === "task-out" && edge.targetHandle === "task-in") {
        return { ...edge, type: "reconciliationEdge" };
      }
      return edge;
    });
  }
};
