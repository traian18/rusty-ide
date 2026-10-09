/**
 * LoopEdge — the dotted line from a step that sends work back (a verify
 * step's retry target, an approval's revise target) to the earlier step it
 * goes to. It leaves the source to the right, runs below every card it
 * passes, and comes up into the target from the left, so it never hides
 * behind a card. Nested loops get deeper lanes so they do not overlap.
 */

import React, { useCallback } from "react";
import { BaseEdge, useStore, type Edge, type EdgeProps, type ReactFlowState } from "@xyflow/react";

export interface LoopEdgeData extends Record<string, unknown> {
  /** 0 for the innermost loop; each enclosing loop runs one lane lower. */
  lane: number;
}

export type LoopFlowEdge = Edge<LoopEdgeData, "loop">;

/** Gap between the lowest card and the first lane, and between lanes. */
const CLEARANCE = 40;
const LANE_GAP = 26;
/** How far the line runs out of a handle before turning. */
const STUB = 18;
const STUB_STEP = 6;
const RADIUS = 8;

/** A polyline through `points` with rounded corners. */
function rounded(points: Array<[number, number]>, radius: number): string {
  let path = `M ${points[0][0]},${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1];
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    const r = Math.min(radius, Math.hypot(x - px, y - py) / 2, Math.hypot(nx - x, ny - y) / 2);
    const inX = x - Math.sign(x - px) * r;
    const inY = y - Math.sign(y - py) * r;
    const outX = x + Math.sign(nx - x) * r;
    const outY = y + Math.sign(ny - y) * r;
    path += ` L ${inX},${inY} Q ${x},${y} ${outX},${outY}`;
  }
  const [lx, ly] = points[points.length - 1];
  return `${path} L ${lx},${ly}`;
}

/**
 * The loop's path from the source handle (right side) to the target handle
 * (left side), with its bottom run at `floor` (below the lowest card it
 * passes) plus its lane, and the label position in the middle of that run.
 */
export function loopPath(
  source: { x: number; y: number },
  target: { x: number; y: number },
  floor: number,
  lane: number,
): { path: string; labelX: number; labelY: number } {
  const y = Math.max(floor, source.y, target.y) + CLEARANCE + lane * LANE_GAP;
  const stub = STUB + lane * STUB_STEP;
  const out = source.x + stub;
  const back = target.x - stub;
  const path = rounded(
    [
      [source.x, source.y],
      [out, source.y],
      [out, y],
      [back, y],
      [back, target.y],
      [target.x, target.y],
    ],
    RADIUS,
  );
  return { path, labelX: (out + back) / 2, labelY: y };
}

/** The bottom of the lowest card whose span overlaps `left`..`right`. */
function lowestCardBetween(state: ReactFlowState, left: number, right: number): number {
  let lowest = -Infinity;
  for (const node of state.nodeLookup.values()) {
    const { x, y } = node.internals.positionAbsolute;
    const width = node.measured.width ?? node.width ?? 0;
    const height = node.measured.height ?? node.height ?? 0;
    if (x + width < left || x > right) continue;
    lowest = Math.max(lowest, y + height);
  }
  return lowest;
}

export const LoopEdge: React.FC<EdgeProps<LoopFlowEdge>> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  label,
  style,
  markerEnd,
  labelStyle,
  labelBgStyle,
}) => {
  const lane = data?.lane ?? 0;
  const stub = STUB + lane * STUB_STEP;
  const left = Math.min(sourceX, targetX) - stub;
  const right = Math.max(sourceX, targetX) + stub;
  const floor = useStore(useCallback((state: ReactFlowState) => lowestCardBetween(state, left, right), [left, right]));
  const { path, labelX, labelY } = loopPath({ x: sourceX, y: sourceY }, { x: targetX, y: targetY }, floor, lane);
  return (
    <BaseEdge
      id={id}
      path={path}
      style={style}
      markerEnd={markerEnd}
      label={label}
      labelX={labelX}
      labelY={labelY}
      labelStyle={labelStyle}
      labelBgStyle={labelBgStyle}
      labelShowBg
      labelBgPadding={[4, 2]}
    />
  );
};

export const behaviorEdgeTypes = { loop: LoopEdge };
