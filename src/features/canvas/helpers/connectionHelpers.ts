/**
 * connectionHelpers.ts
 *
 * Pure functions for validating and computing connections between canvas nodes.
 * These have no React or store dependencies — they operate solely on node/edge data.
 */

import type { Node, Edge } from "@xyflow/react";

/**
 * Validates whether a connection (edge) between two nodes is semantically allowed.
 *
 * Rules:
 * - No self-loops.
 * - contextNode ↔ contextNode is forbidden.
 * - mcpNode ↔ mcpNode is forbidden.
 * - contextNode/mcpNode may only connect into a taskNode via "context-in*" handles.
 * - taskNode → taskNode is allowed only via "task-out" → "task-in".
 *
 * @returns `true` if the connection is valid.
 */
export function isValidConnection(
  connection: { source: string; target: string; sourceHandle: string | null; targetHandle: string | null },
  nodes: Node[]
): boolean {
  const { source, target, sourceHandle, targetHandle } = connection;

  // No self-loops
  if (source === target) return false;

  const sourceNode = nodes.find((n) => n.id === source);
  const targetNode = nodes.find((n) => n.id === target);
  if (!sourceNode || !targetNode) return false;

  const sourceType = sourceNode.type;
  const targetType = targetNode.type;

  // Homogeneous type restrictions
  if (sourceType === "contextNode" && targetType === "contextNode") return false;
  if (sourceType === "mcpNode" && targetType === "mcpNode") return false;

  // Context or MCP nodes must connect only into a taskNode via context-in handles
  if (sourceType === "contextNode" || sourceType === "mcpNode") {
    if (targetType !== "taskNode" || !targetHandle?.startsWith("context-in")) return false;
  }

  // Task-to-task must use dedicated handles
  if (sourceType === "taskNode" && targetType === "taskNode") {
    if (sourceHandle !== "task-out" || targetHandle !== "task-in") return false;
  }

  return true;
}

/**
 * Computes a possible connection (if any) between two nodes, respecting
 * connection validation rules and avoiding duplicate existing edges.
 *
 * Tries both directions (node1 → node2, node2 → node1).
 *
 * @returns A connection descriptor or `null` if no valid connection exists.
 */
export function getPossibleConnection(
  node1: Node,
  node2: Node,
  nodes: Node[],
  edges: Edge[]
): { source: string; target: string; sourceHandle: string; targetHandle: string } | null {
  if (!node1 || !node2 || node1.id === node2.id) return null;

  const checkDirection = (
    src: Node,
    dst: Node
  ): { source: string; target: string; sourceHandle: string; targetHandle: string } | null => {
    // Task → Task
    if (src.type === "taskNode" && dst.type === "taskNode") {
      const conn = {
        source: src.id,
        target: dst.id,
        sourceHandle: "task-out" as const,
        targetHandle: "task-in" as const,
      };
      if (isValidConnection(conn, nodes) && !edgeExists(edges, conn)) {
        return conn;
      }
    }

    // Context/MCP → Task
    if ((src.type === "contextNode" || src.type === "mcpNode") && dst.type === "taskNode") {
      const isSrcAbove = src.position.y < dst.position.y;
      const sourceHandle = isSrcAbove ? "context-out-bottom" : "context-out-top";
      const targetHandle = isSrcAbove ? "context-in-top" : "context-in-bottom";

      const conn = {
        source: src.id,
        target: dst.id,
        sourceHandle,
        targetHandle,
      };
      if (isValidConnection(conn, nodes) && !edgeExists(edges, conn)) {
        return conn;
      }
    }

    return null;
  };

  // Try both directions
  const firstTry = checkDirection(node1, node2);
  if (firstTry) return firstTry;

  return checkDirection(node2, node1);
}

/** Checks whether an identical edge already exists in the list. */
function edgeExists(
  edges: Edge[],
  conn: { source: string; target: string; sourceHandle: string; targetHandle: string }
): boolean {
  return edges.some(
    (e) =>
      e.source === conn.source &&
      e.target === conn.target &&
      e.sourceHandle === conn.sourceHandle &&
      e.targetHandle === conn.targetHandle
  );
}
