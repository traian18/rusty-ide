import React from "react";

/**
 * Vertical resize handle on the left edge of the pane.
 *
 * Hidden when the pane is maximized (the resize action is disabled).
 */
export const ResizeHandle: React.FC<{
  isMaximized: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
}> = ({ isMaximized, onMouseDown }) => {
  if (isMaximized) return null;

  return (
    <div
      onMouseDown={onMouseDown}
      className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-[var(--color-status-danger-bg)] active:bg-[var(--color-status-danger-solid)] transition-colors z-50"
      style={{ transform: "translateX(-50%)" }}
    />
  );
};
