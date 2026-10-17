import { useId } from "react";
import { BaseEdge, type Edge, type EdgeProps } from "@xyflow/react";
import { bandPath } from "./bands";
import { CYCLE_COLOR, NEUTRAL_COLOR } from "./palette";

export type BandEdgeData = { from: string; to: string; cycle: boolean } & Record<string, unknown>;
export type ArchitectureFlowEdge = Edge<BandEdgeData, "arch-band">;

/** An arc that fades from the colour of the node it leaves to the colour of the node it reaches. */
export function BandEdge({ id, sourceX, sourceY, targetX, targetY, data, style, label }: EdgeProps<ArchitectureFlowEdge>) {
  const gradient = `band-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const { path, labelX, labelY } = bandPath(sourceX, sourceY, targetX, targetY);
  const cycle = data?.cycle === true;
  return (
    <>
      {cycle ? null : (
        <defs>
          <linearGradient id={gradient} gradientUnits="userSpaceOnUse" x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}>
            <stop offset="0%" stopColor={data?.from || NEUTRAL_COLOR} />
            <stop offset="100%" stopColor={data?.to || NEUTRAL_COLOR} />
          </linearGradient>
        </defs>
      )}
      <BaseEdge
        id={id}
        path={path}
        style={{ ...style, stroke: cycle ? CYCLE_COLOR : `url(#${gradient})` }}
        label={label}
        labelX={labelX}
        labelY={labelY}
        labelStyle={{ fill: "var(--color-fg-strong)" }}
        labelBgStyle={{ fill: "var(--color-surface-elevated)" }}
      />
    </>
  );
}

export const architectureEdgeTypes = { "arch-band": BandEdge };
