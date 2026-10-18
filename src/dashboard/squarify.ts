/** Squarified treemap layout: rectangles whose areas follow the weights and whose sides stay close to square. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Placed<T> extends Rect {
  item: T;
}

function worst(row: number[], side: number): number {
  const sum = row.reduce((a, b) => a + b, 0);
  const max = Math.max(...row);
  const min = Math.min(...row);
  const s2 = side * side;
  const sum2 = sum * sum;
  return Math.max((s2 * max) / sum2, sum2 / (s2 * min));
}

/** Lays `items` (any order; sorted largest first here) into `bounds`. Zero weights get no area. */
export function squarify<T>(items: readonly T[], weight: (item: T) => number, bounds: Rect): Placed<T>[] {
  const sorted = items.map((item) => ({ item, w: Math.max(0, weight(item)) })).filter((e) => e.w > 0).sort((a, b) => b.w - a.w);
  const total = sorted.reduce((a, e) => a + e.w, 0);
  if (!total || bounds.w <= 0 || bounds.h <= 0) return [];
  const scale = (bounds.w * bounds.h) / total;
  const areas = sorted.map((e) => ({ item: e.item, a: e.w * scale }));
  const out: Placed<T>[] = [];
  let free = { ...bounds };
  let index = 0;
  while (index < areas.length) {
    const side = Math.min(free.w, free.h);
    const row: typeof areas = [areas[index]];
    index += 1;
    while (index < areas.length) {
      const next = [...row.map((r) => r.a), areas[index].a];
      if (worst(next, side) > worst(row.map((r) => r.a), side)) break;
      row.push(areas[index]);
      index += 1;
    }
    const rowArea = row.reduce((a, r) => a + r.a, 0);
    const horizontal = free.w >= free.h;
    // A column on the left when the free space is wide, a row on top when it is tall.
    const thickness = rowArea / (horizontal ? free.h : free.w);
    let offset = 0;
    for (const r of row) {
      const length = r.a / thickness;
      out.push(horizontal ? { item: r.item, x: free.x, y: free.y + offset, w: thickness, h: length } : { item: r.item, x: free.x + offset, y: free.y, w: length, h: thickness });
      offset += length;
    }
    free = horizontal ? { x: free.x + thickness, y: free.y, w: free.w - thickness, h: free.h } : { x: free.x, y: free.y + thickness, w: free.w, h: free.h - thickness };
  }
  return out;
}
