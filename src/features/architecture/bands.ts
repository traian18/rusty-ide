/**
 * The curve of a band between two bubble centres: a quadratic arc bowed to the left of the
 * direction of travel. Because a reversed edge bows the other way, two packages that import each
 * other get two separate arcs, and arcs keep clear of most bubbles that a straight line would cross.
 * Pure.
 */
export interface BandPath {
  path: string;
  /** The middle of the arc, where a label goes. */
  labelX: number;
  labelY: number;
}

const MIN_BOW = 24;
const MAX_BOW = 140;
const BOW_RATIO = 0.22;

export function bandPath(sourceX: number, sourceY: number, targetX: number, targetY: number): BandPath {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { path: `M ${sourceX},${sourceY}`, labelX: sourceX, labelY: sourceY };
  const bow = Math.min(MAX_BOW, Math.max(MIN_BOW, length * BOW_RATIO));
  const controlX = (sourceX + targetX) / 2 + (dy / length) * bow;
  const controlY = (sourceY + targetY) / 2 - (dx / length) * bow;
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    path: `M ${round(sourceX)},${round(sourceY)} Q ${round(controlX)},${round(controlY)} ${round(targetX)},${round(targetY)}`,
    // The point of a quadratic curve at t = 0.5.
    labelX: round(0.25 * sourceX + 0.5 * controlX + 0.25 * targetX),
    labelY: round(0.25 * sourceY + 0.5 * controlY + 0.25 * targetY),
  };
}
