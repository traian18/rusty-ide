import { useRef, useState, type RefObject } from "react";
import styles from "./TabOutlet.module.css";

export const SPLIT_WIDTH_KEY = "rusty_tab_split_width";
const MIN = 20;
const MAX = 80;
const DEFAULT = 50;
const KEYBOARD_STEP = 2;

function clamp(percent: number): number {
  return Math.max(MIN, Math.min(MAX, percent));
}

function loadWidth(): number {
  try {
    const saved = localStorage.getItem(SPLIT_WIDTH_KEY);
    const percent = saved === null ? NaN : Number(saved);
    return Number.isFinite(percent) ? clamp(percent) : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

/** The left side's share of the outlet, in percent, and the handle that sets it. */
export function useSplitWidth(outletRef: RefObject<HTMLDivElement | null>) {
  const dragging = useRef(false);
  const [leftPercent, setLeftPercent] = useState(loadWidth);

  const resize = (next: number) => {
    const value = Math.round(clamp(next) * 10) / 10;
    setLeftPercent(value);
    try { localStorage.setItem(SPLIT_WIDTH_KEY, String(value)); } catch { /* optional preference */ }
  };

  const resizeToPointer = (clientX: number) => {
    const outlet = outletRef.current?.getBoundingClientRect();
    if (outlet?.width) resize(((clientX - outlet.left) / outlet.width) * 100);
  };

  const handle = (
    <div
      className={styles.divider}
      role="separator"
      tabIndex={0}
      aria-label="Resize side-by-side tabs"
      aria-orientation="vertical"
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      aria-valuenow={Math.round(leftPercent)}
      onDoubleClick={() => resize(DEFAULT)}
      onKeyDown={(event) => {
        const next = event.key === "ArrowLeft" ? leftPercent - KEYBOARD_STEP
          : event.key === "ArrowRight" ? leftPercent + KEYBOARD_STEP
          : event.key === "Home" ? MIN
          : event.key === "End" ? MAX
          : undefined;
        if (next !== undefined) {
          event.preventDefault();
          resize(next);
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (dragging.current) resizeToPointer(event.clientX);
      }}
      onPointerUp={() => { dragging.current = false; }}
      onPointerCancel={() => { dragging.current = false; }}
      onLostPointerCapture={() => { dragging.current = false; }}
    />
  );

  return { leftPercent, handle };
}
