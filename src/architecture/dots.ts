/**
 * Packs the small circles that preview a node's components inside the node's own circle: biggest
 * in the middle, the rest spiralling outwards, none overlapping and all inside. Pure and
 * deterministic, so the same node always looks the same.
 */
export interface Dot {
  /** Centre relative to the middle of the enclosing circle. */
  x: number;
  y: number;
  r: number;
}

const GOLDEN_ANGLE = 2.399963229728653;
const MIN_RADIUS = 3.5;
const GAP = 2;
/** Share of the enclosing radius the dots may reach. */
const REACH = 0.84;
const MAX_SHRINKS = 14;

/** One position per size, in the order given; sizes are file counts. */
export function packDots(sizes: readonly number[], radius: number): Dot[] {
  if (sizes.length === 0 || radius <= 0) return [];
  const largest = Math.max(1, ...sizes);
  let base = radius * (sizes.length === 1 ? 0.42 : 0.3);
  for (let attempt = 0; attempt <= MAX_SHRINKS; attempt++, base *= 0.86) {
    const placed = tryPack(sizes, largest, base, radius);
    if (placed) return placed;
  }
  // Tiny circles: stack on the spiral without the overlap test rather than draw nothing.
  return sizes.map((_, index) => ({ x: 0, y: 0, r: MIN_RADIUS / (index + 1) }));
}

function tryPack(sizes: readonly number[], largest: number, base: number, radius: number): Dot[] | null {
  const placed: Dot[] = [];
  const step = Math.max(1, radius * 0.07);
  for (const size of sizes) {
    const r = Math.max(MIN_RADIUS, base * Math.sqrt(Math.max(0, size) / largest));
    let found: Dot | null = null;
    for (let k = 0; k < 600 && !found; k++) {
      const distance = step * Math.sqrt(k);
      if (distance + r > radius * REACH) break;
      const x = distance * Math.cos(k * GOLDEN_ANGLE);
      const y = distance * Math.sin(k * GOLDEN_ANGLE);
      if (placed.every((other) => Math.hypot(other.x - x, other.y - y) >= other.r + r + GAP)) found = { x, y, r };
    }
    if (!found) return null;
    placed.push(found);
  }
  return placed;
}
