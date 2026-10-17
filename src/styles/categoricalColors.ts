/**
 * Distinct colours for telling categories apart (packages, languages, series, tags). They are the
 * one place such colours are defined: the theme exposes them as `--color-category-1` ...
 * `--color-category-12`, so components use `categoryVar(index)` or the variables directly and the
 * set follows the light or dark appearance. Semantic colours (success, warning, danger, info,
 * primary) are separate and keep their meaning; none of these is used for status.
 */

export const CATEGORY_COUNT = 12;

/** Lighter on dark themes, deeper on light themes, so each stays readable on its background. */
export const CATEGORICAL_COLORS = {
  dark: ["#60a5fa", "#34d399", "#fbbf24", "#a78bfa", "#f472b6", "#22d3ee", "#fb923c", "#a3e635", "#818cf8", "#2dd4bf", "#e879f9", "#fda4af"],
  light: ["#2563eb", "#059669", "#d97706", "#7c3aed", "#db2777", "#0891b2", "#ea580c", "#65a30d", "#4f46e5", "#0d9488", "#c026d3", "#e11d48"],
} as const;

/** The CSS variables for one appearance, ready to merge into the theme's variable map. */
export function categoricalCssVariables(appearance: "light" | "dark"): Record<string, string> {
  const colors = CATEGORICAL_COLORS[appearance === "light" ? "light" : "dark"];
  return Object.fromEntries(colors.map((color, index) => [`--color-category-${index + 1}`, color]));
}

/** The CSS reference for a category slot; any integer is accepted and wraps around the palette. */
export function categoryVar(index: number): string {
  const slot = ((Math.trunc(index) % CATEGORY_COUNT) + CATEGORY_COUNT) % CATEGORY_COUNT;
  return `var(--color-category-${slot + 1})`;
}

/** A stable hash of a string (FNV-1a). */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Gives each key a category slot. A key starts at the slot its hash picks, so it keeps its colour
 * while the set is unchanged, and moves on to the next free slot if that one is taken, so up to
 * twelve keys never share a colour. Beyond twelve the least used slot is reused. Keys are handled
 * in sorted order, so the result does not depend on input order.
 */
export function assignCategories(keys: readonly string[]): Map<string, number> {
  const used = new Array<number>(CATEGORY_COUNT).fill(0);
  const slots = new Map<string, number>();
  for (const key of [...new Set(keys)].sort()) {
    const start = hashString(key) % CATEGORY_COUNT;
    let best = start;
    for (let step = 0; step < CATEGORY_COUNT; step++) {
      const candidate = (start + step) % CATEGORY_COUNT;
      if (used[candidate] < used[best]) best = candidate;
      if (used[candidate] === 0) {
        best = candidate;
        break;
      }
    }
    used[best]++;
    slots.set(key, best);
  }
  return slots;
}
