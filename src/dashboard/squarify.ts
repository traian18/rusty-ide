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

/** Scores how poorly a group of areas fits in a strip; lower scores mean squarer rectangles. */
function worstAspectRatio(areas: number[], shortSideLength: number): number {
  const totalArea = areas.reduce((sum, area) => sum + area, 0);
  const largestArea = Math.max(...areas);
  const smallestArea = Math.min(...areas);
  const shortSideSquared = shortSideLength * shortSideLength;
  const totalAreaSquared = totalArea * totalArea;

  return Math.max(
    (shortSideSquared * largestArea) / totalAreaSquared,
    totalAreaSquared / (shortSideSquared * smallestArea),
  );
}

/**
 * Places positive-weight items in a treemap within `bounds`.
 *
 * Items receive areas proportional to their weights. The function sorts items
 * from largest to smallest, then groups them into strips to keep their
 * rectangles as close to square as possible. A strip is placed along the left
 * edge when the remaining space is wide, or along the top edge when it is tall.
 *
 * Items with zero or negative weights are omitted. Results are returned in
 * layout order, not the original input order.
 */
export function squarify<T>(
  items: readonly T[],
  weight: (item: T) => number,
  bounds: Rect,
): Placed<T>[] {
  const itemsByWeight = items
    .map((item) => ({ item, weight: Math.max(0, weight(item)) }))
    .filter(({ weight }) => weight > 0)
    .sort((left, right) => right.weight - left.weight);

  const totalWeight = itemsByWeight.reduce((sum, entry) => sum + entry.weight, 0);
  if (!totalWeight || bounds.w <= 0 || bounds.h <= 0) return [];

  // Convert weights into rectangle areas that add up to the bounds' area.
  const areaPerWeight = (bounds.w * bounds.h) / totalWeight;
  const itemsByArea = itemsByWeight.map(({ item, weight }) => ({
    item,
    area: weight * areaPerWeight,
  }));

  const placedItems: Placed<T>[] = [];
  let remainingBounds = { ...bounds };
  let nextItemIndex = 0;

  while (nextItemIndex < itemsByArea.length) {
    const shortSideLength = Math.min(remainingBounds.w, remainingBounds.h);
    const firstItem = itemsByArea[nextItemIndex];
    const stripItems = [firstItem];
    let stripAreas = [firstItem.area];
    let stripScore = worstAspectRatio(stripAreas, shortSideLength);
    nextItemIndex += 1;

    // Add items while doing so improves the strip's rectangle proportions.
    while (nextItemIndex < itemsByArea.length) {
      const nextItem = itemsByArea[nextItemIndex];
      const candidateAreas = [...stripAreas, nextItem.area];
      const candidateScore = worstAspectRatio(candidateAreas, shortSideLength);

      if (candidateScore > stripScore) break;

      stripItems.push(nextItem);
      stripAreas = candidateAreas;
      stripScore = candidateScore;
      nextItemIndex += 1;
    }

    const stripArea = stripItems.reduce((sum, entry) => sum + entry.area, 0);
    const remainingAreaIsWide = remainingBounds.w >= remainingBounds.h;
    const stripThickness =
      stripArea / (remainingAreaIsWide ? remainingBounds.h : remainingBounds.w);

    let offset = 0;

    for (const entry of stripItems) {
      const itemLength = entry.area / stripThickness;

      if (remainingAreaIsWide) {
        placedItems.push({
          item: entry.item,
          x: remainingBounds.x,
          y: remainingBounds.y + offset,
          w: stripThickness,
          h: itemLength,
        });
      } else {
        placedItems.push({
          item: entry.item,
          x: remainingBounds.x + offset,
          y: remainingBounds.y,
          w: itemLength,
          h: stripThickness,
        });
      }

      offset += itemLength;
    }

    // Remove the strip from the available space before laying out the next one.
    remainingBounds = remainingAreaIsWide
      ? {
          x: remainingBounds.x + stripThickness,
          y: remainingBounds.y,
          w: remainingBounds.w - stripThickness,
          h: remainingBounds.h,
        }
      : {
          x: remainingBounds.x,
          y: remainingBounds.y + stripThickness,
          w: remainingBounds.w,
          h: remainingBounds.h - stripThickness,
        };
  }

  return placedItems;
}
