/**
 * Border/glow style mappings for each node execution status.
 * Applied to the outer container to give visual feedback on state.
 */

export type NodeExecutionStatus = "idle" | "running" | "success" | "error";

export const STATUS_BORDER_CLASSES: Record<NodeExecutionStatus, string> = {
  idle: "border-[var(--border-color)] hover:border-[var(--color-status-danger-border)]",
  running:
    "border-[var(--color-status-info-border)] shadow-[0_0_15px_var(--color-status-info-bg)] animate-pulse",
  success:
    "border-[var(--color-status-success-border)] shadow-[0_0_10px_var(--color-status-success-bg)]",
  error:
    "border-[var(--color-status-danger-border)] shadow-[0_0_10px_var(--color-status-danger-bg)]",
};
