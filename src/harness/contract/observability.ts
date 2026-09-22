/** IDE-owned provenance attached to a harness run. Backends may use it for
 * observability, but it never changes execution semantics. */
export type ExecutionSurface =
  | "agent-tab"
  | "canvas-node"
  | "inline-chat"
  | "reconciliation"
  | "skill-generation"
  | "test-build"
  | "other";

export interface ExecutionOrigin {
  surface: ExecutionSurface;
  workspaceId?: string;
  tabId?: string;
  canvasId?: string;
  nodeId?: string;
  displayLabel: string;
}
