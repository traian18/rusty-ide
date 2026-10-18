import { Maximize2, Minus, Plus } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

import { compact } from "../dashboard/format";
import { packTree, type PackedCircle } from "../dashboard/pack";
import { pathTree } from "../dashboard/pathTree";
import d from "../dashboard/Dashboard.module.css";
import { BAND_LABEL, BAND_ORDER, type Band, type HealthFileRow } from "./model";
import s from "./Health.module.css";

/** Used before the map has been measured, and where nothing can measure it (tests). */
const FALLBACK = { w: 960, h: 576 };
const MARGIN = 8;
const STEP = 1.5;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 64;
/** A folder is named once its circle is this wide on screen; a file needs more. */
const FOLDER_LABEL_R = 28;
const FILE_LABEL_R = 26;
/** A pointer that moves this far between down and up was a drag, not a click. */
const DRAG = 4;

export const BAND_FILL: Record<Band, string> = {
  excellent: "var(--color-status-success-solid)",
  good: "color-mix(in srgb, var(--color-status-success-solid) 55%, var(--color-surface-panel))",
  fair: "var(--color-status-warning-solid)",
  needs_work: "color-mix(in srgb, var(--color-status-warning-solid) 40%, var(--color-status-danger-solid))",
  at_risk: "var(--color-status-danger-solid)",
};
const UNSCORED = "var(--color-surface-sunken)";

interface View {
  k: number;
  x: number;
  y: number;
}
const FIT: View = { k: 1, x: 0, y: 0 };

const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

/** Circles do not change while zooming or hovering, so they render once per layout. */
const Circles = memo(function Circles({ packed, selected }: { packed: PackedCircle<HealthFileRow>[]; selected: string | null }) {
  return (
    <>
      {packed.map((circle, index) => {
        const row = circle.node.item;
        if (!row) {
          if (circle.depth === 0) return null;
          return <circle key={`d:${circle.node.path}`} data-index={index} className={s.mapFolder} data-depth={Math.min(circle.depth, 3)} cx={circle.x} cy={circle.y} r={circle.r} vectorEffect="non-scaling-stroke" />;
        }
        return (
          <circle
            key={row.path}
            data-index={index}
            className={s.mapFile}
            data-selected={selected === row.path || undefined}
            cx={circle.x}
            cy={circle.y}
            r={circle.r}
            style={{ fill: row.band ? BAND_FILL[row.band] : UNSCORED }}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </>
  );
});

function Tooltip({ circle, at }: { circle: PackedCircle<HealthFileRow>; at: { x: number; y: number } }) {
  const row = circle.node.item;
  return (
    <div className={s.mapTip} style={{ left: at.x + 14, top: at.y + 14 }} role="tooltip">
      <strong>{circle.node.path || "repository"}</strong>
      {row ? (
        <>
          <span>
            {row.defect === null ? "not scored" : `${row.defect.toFixed(1)} · ${row.band ? BAND_LABEL[row.band] : ""}`} · {compact(row.nloc)} lines{row.hotspot ? " · hotspot" : ""}
            {row.test ? " · test" : ""}
          </span>
          {row.topIssue ? <span className={d.muted}>{row.topIssue}</span> : null}
        </>
      ) : (
        <span>
          {circle.node.files} files · {compact(circle.node.weight)} lines · click to zoom in
        </span>
      )}
    </div>
  );
}

export interface HealthMapProps {
  rows: HealthFileRow[];
  selected: string | null;
  onSelect(path: string): void;
}

/**
 * Every file as a circle sized by its lines and painted by its health band, nested in circles for
 * its folders, so where the weak code sits shows at a glance. Zoom with the buttons, the wheel or
 * a click on a folder; drag to pan.
 */
export function HealthMap({ rows, selected, onSelect }: HealthMapProps) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(FALLBACK);
  const [view, setView] = useState<View>(FIT);
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null);
  const [tests, setTests] = useState(true);
  const drag = useRef<{ x: number; y: number; view: View; moved: boolean } | null>(null);
  useEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ w: width, h: height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const shown = useMemo(() => (tests ? rows : rows.filter((r) => !r.test)), [rows, tests]);
  const radius = Math.max(10, Math.min(size.w, size.h) / 2 - MARGIN);
  const packed = useMemo(() => packTree(pathTree(shown, (r) => r.path, (r) => Math.max(r.nloc, 1)), radius), [shown, radius]);
  const counts = useMemo(() => {
    const by = new Map<Band | null, number>();
    for (const row of shown) by.set(row.band, (by.get(row.band) ?? 0) + 1);
    return by;
  }, [shown]);

  const cx = size.w / 2 + view.x;
  const cy = size.h / 2 + view.y;
  /** Zooms by `factor` keeping the screen point (px, py) still. */
  const zoomAt = (factor: number, px = size.w / 2, py = size.h / 2) =>
    setView((v) => {
      const k = clampZoom(v.k * factor);
      const ratio = k / v.k;
      const ox = size.w / 2 + v.x;
      const oy = size.h / 2 + v.y;
      return { k, x: px - (px - ox) * ratio - size.w / 2, y: py - (py - oy) * ratio - size.h / 2 };
    });
  const focus = (circle: PackedCircle<HealthFileRow>) => {
    const k = clampZoom((radius / Math.max(circle.r, 1e-6)) * 0.95);
    setView({ k, x: -circle.x * k, y: -circle.y * k });
  };
  const circleAt = (target: EventTarget) => {
    const index = (target as Element).getAttribute?.("data-index");
    return index === null || index === undefined ? null : Number(index);
  };
  const local = (event: { clientX: number; clientY: number }) => {
    const rect = box.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };

  // React's wheel listener is passive; a native one can stop the page from scrolling.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  });

  const onPointerDown = (event: ReactPointerEvent) => {
    drag.current = { x: event.clientX, y: event.clientY, view, moved: false };
  };
  const onPointerMove = (event: ReactPointerEvent) => {
    const start = drag.current;
    if (start && event.buttons === 1) {
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (start.moved || Math.hypot(dx, dy) > DRAG) {
        start.moved = true;
        setView({ ...start.view, x: start.view.x + dx, y: start.view.y + dy });
        setHover(null);
        return;
      }
    }
    const index = circleAt(event.target);
    setHover(index === null || !packed[index] || packed[index].depth === 0 ? null : { index, ...local(event) });
  };
  const onClick = (event: ReactMouseEvent) => {
    const wasDrag = drag.current?.moved;
    drag.current = null;
    if (wasDrag) return;
    const index = circleAt(event.target);
    const circle = index === null ? undefined : packed[index];
    if (!circle) return;
    if (circle.node.item) onSelect(circle.node.path);
    else focus(circle);
  };

  // Names in screen space, so they keep their size at any zoom.
  const labels = packed.flatMap((circle) => {
    const r = circle.r * view.k;
    const x = cx + circle.x * view.k;
    const y = cy + circle.y * view.k;
    if (circle.depth === 0 || x + r < 0 || x - r > size.w || y + r < 0 || y - r > size.h) return [];
    const file = Boolean(circle.node.item);
    if (r < (file ? FILE_LABEL_R : FOLDER_LABEL_R)) return [];
    const room = Math.max(3, Math.floor((r * (file ? 1.8 : 1.4)) / 6.5));
    const name = circle.node.name.length > room ? `${circle.node.name.slice(0, room - 1)}…` : circle.node.name;
    return [{ key: circle.node.path, file, x, y: file ? y + 4 : y - r + 14, name, depth: circle.depth }];
  });

  return (
    <div>
      <div className={d.toolbar}>
        <span className={d.muted}>
          {shown.length} files, grouped by folder; size is lines of code, colour is the health band
        </span>
        <span className={d.spacer} />
        <label className={d.muted}>
          <input type="checkbox" checked={tests} onChange={(event) => setTests(event.target.checked)} /> Include tests
        </label>
      </div>
      <div
        ref={box}
        className={s.healthMap}
        role="group"
        aria-label="Code health map"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHover(null)}
        onClick={onClick}
      >
        <svg width={size.w} height={size.h} className={s.mapSvg}>
          <g transform={`translate(${cx} ${cy}) scale(${view.k})`}>
            <Circles packed={packed} selected={selected} />
          </g>
          <g className={s.mapLabels} aria-hidden>
            {labels.map((label) => (
              <text key={label.key} x={label.x} y={label.y} textAnchor="middle" data-file={label.file || undefined} data-depth={Math.min(label.depth, 3)}>
                {label.name}
              </text>
            ))}
          </g>
        </svg>
        <div className={s.mapZoom}>
          <button type="button" aria-label="Zoom in" title="Zoom in" onClick={(event) => (event.stopPropagation(), zoomAt(STEP))}>
            <Plus size={14} aria-hidden />
          </button>
          <button type="button" aria-label="Zoom out" title="Zoom out" onClick={(event) => (event.stopPropagation(), zoomAt(1 / STEP))}>
            <Minus size={14} aria-hidden />
          </button>
          <button type="button" aria-label="Fit" title="Fit the whole repository" onClick={(event) => (event.stopPropagation(), setView(FIT))}>
            <Maximize2 size={14} aria-hidden />
          </button>
        </div>
        {hover && packed[hover.index] ? <Tooltip circle={packed[hover.index]} at={hover} /> : null}
      </div>
      <div className={d.legend} aria-label="Legend">
        {[...BAND_ORDER].reverse().map((band) => (
          <span key={band}>
            <span className={d.swatch} style={{ background: BAND_FILL[band] }} aria-hidden />
            {BAND_LABEL[band]} ({counts.get(band) ?? 0})
          </span>
        ))}
        <span>
          <span className={d.swatch} style={{ background: UNSCORED }} aria-hidden />
          not scored ({counts.get(null) ?? 0})
        </span>
        <span>· click a folder to zoom in, a file to see its issues</span>
      </div>
    </div>
  );
}
