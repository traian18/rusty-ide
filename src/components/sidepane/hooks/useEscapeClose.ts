/**
 * useEscapeClose.ts
 *
 * Closes the side pane when the Escape key is pressed.
 */

import { useEffect } from "react";

/**
 * Registers a `keydown` listener that calls `onClose` when Escape is pressed.
 *
 * @param onClose - Callback invoked on Escape key press.
 */
export function useEscapeClose(onClose: () => void): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);
}
