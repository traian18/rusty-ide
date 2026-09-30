import { useEffect, useRef, useState } from "react";
import styles from "./Behaviors.module.css";

export const INSPECTOR_WIDTH_KEY = "rusty_workflow_inspector_width";
const MIN = 280;
const DEFAULT = 384;
export function useInspectorWidth() {
  const bodyRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [maximum, setMaximum] = useState(800);
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(INSPECTOR_WIDTH_KEY));
      return Number.isFinite(saved) && saved >= MIN ? Math.min(800, saved) : DEFAULT;
    } catch { return DEFAULT; }
  });
  const resize = (next: number) => {
    const value = Math.round(Math.max(MIN, Math.min(maximum, next)));
    setWidth(value);
    try { localStorage.setItem(INSPECTOR_WIDTH_KEY, String(value)); } catch { /* optional preference */ }
  };
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const update = () => {
      const available = body.getBoundingClientRect().width;
      if (!available) return;
      const max = Math.max(MIN, Math.min(800, available - 384));
      setMaximum(max);
      setWidth((current) => Math.min(current, max));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(body);
    return () => observer.disconnect();
  }, []);
  const handle = <div className={styles.resizeHandle} role="separator" tabIndex={0}
    aria-label="Resize configuration sidebar" aria-orientation="vertical"
    aria-valuemin={MIN} aria-valuemax={maximum} aria-valuenow={width}
    onDoubleClick={() => resize(DEFAULT)}
    onKeyDown={(event) => {
      const next = event.key === "ArrowLeft" ? width + 24 : event.key === "ArrowRight" ? width - 24
        : event.key === "Home" ? MIN : event.key === "End" ? maximum : undefined;
      if (next !== undefined) { event.preventDefault(); resize(next); }
    }}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      drag.current = { x: event.clientX, width };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={(event) => {
      if (drag.current) resize(drag.current.width + drag.current.x - event.clientX);
    }}
    onPointerUp={(event) => {
      drag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} />;
  return { bodyRef, width, handle };
}
