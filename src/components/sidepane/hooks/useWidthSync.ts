/**
 * useWidthSync.ts
 *
 * Restores the pane's RESTORE width (the narrow width it returns to when
 * un-maximized) from localStorage when the storage key changes (e.g. when a
 * different node type is selected).
 */

import { useEffect } from "react";

/**
 * Synchronises the `width` state (React's single source of truth for the
 * container's actual CSS width, applied via SidePane.tsx's own
 * `style={{width: isMaximized ? "100%" : `${width}px`}}`) with the value
 * persisted in localStorage identified by `storageKey`.
 *
 * Only calls `setWidth` -- does NOT also write `containerRef.current.style
 * .width` directly. That direct write used to run unconditionally on every
 * mount, regardless of `isMaximized`, silently overwriting whatever width
 * SidePane.tsx's own render had just applied; invisible while the pane
 * defaulted to its narrow width (both agreed), but a real bug once it
 * started defaulting to full-screen -- this effect would still stomp the
 * DOM width down to the persisted narrow value right after mount, and only
 * a subsequent re-render (e.g. toggling maximize) restored "100%" via
 * React's own reconciliation. `containerRef` is kept as a parameter for
 * call-site compatibility even though this hook no longer touches it.
 *
 * @param storageKey   - localStorage key used to persist width.
 * @param setWidth     - State setter to update the React width value.
 * @param containerRef - Unused; kept for call-site compatibility.
 */
export function useWidthSync(
  storageKey: string,
  setWidth: (width: number) => void,
  containerRef: React.RefObject<HTMLDivElement | null>
): void {
  void containerRef;
  useEffect(() => {
    const stored = localStorage.getItem(storageKey);

    if (stored) {
      const val = parseInt(stored, 10);
      if (!isNaN(val) && val > 200 && val < 1200) {
        setWidth(val);
        return;
      }
    }

    setWidth(500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
}
