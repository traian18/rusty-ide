/**
 * How much of a node to draw at a given zoom: bubbles alone when zoomed out, a name and count in
 * between, everything once zoomed in. Pure.
 */
export type Detail = "far" | "mid" | "near";

export const FAR_BELOW = 0.55;
export const NEAR_FROM = 1.25;

export function detailFor(zoom: number): Detail {
  if (zoom < FAR_BELOW) return "far";
  return zoom < NEAR_FROM ? "mid" : "near";
}

/** How many of the largest nodes keep their name even when zoomed out. */
export const MAJOR_COUNT = 8;
