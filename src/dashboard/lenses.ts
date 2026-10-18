/**
 * What each lens paints, as pure functions of one tile. The legend and the map both call these,
 * so they cannot disagree. Each lens carries one meaning; a tile a lens has no signal for is
 * painted neutral, close to the background.
 */
import { categoryVar, CATEGORY_COUNT } from "../styles/categoricalColors";
import type { MapLevel, Tile } from "./model";

export type Lens = "language" | "churn" | "dependents" | "findings" | "owner";

export const LENSES: { id: Lens; name: string; hint: string }[] = [
  { id: "language", name: "Language", hint: "The language with the most lines in each tile." },
  { id: "churn", name: "Churn", hint: "Commits in the analysed history; darker changed more." },
  { id: "dependents", name: "Dependents", hint: "How many files import the most-imported file in the tile, as a percentile." },
  { id: "findings", name: "Findings", hint: "The most severe open finding in the tile." },
  { id: "owner", name: "Owner", hint: "Files where one person made most of the changes." },
];

export const NEUTRAL = "var(--color-surface-sunken)";
const RAMP = "var(--color-primary)";

/** A step of the sequential ramp, 0 to 1. Steps rather than a gradient, so the legend can name them. */
const STEPS = [0.15, 0.35, 0.55, 0.75, 0.95];
const ramp = (step: number) => `color-mix(in srgb, ${RAMP} ${Math.round(STEPS[step] * 100)}%, var(--color-surface-panel))`;

function step(value: number, max: number): number {
  if (max <= 0 || value <= 0) return -1;
  // Square root, so a handful of very busy files do not leave every other tile in the first step.
  const share = Math.sqrt(value / max);
  return Math.min(STEPS.length - 1, Math.floor(share * STEPS.length));
}

export function languageColor(language: string, ranks: readonly string[]): string {
  const rank = ranks.indexOf(language);
  // Past the palette, languages share one "other" colour rather than repeating one.
  return rank < 0 || rank >= CATEGORY_COUNT - 1 ? `var(--color-fg-muted)` : categoryVar(rank);
}

export function fill(lens: Lens, tile: Tile, level: Pick<MapLevel, "languageRanks" | "maxCommits">): string {
  switch (lens) {
    case "language":
      return tile.languages.length ? languageColor(tile.languages[0][0], level.languageRanks) : NEUTRAL;
    case "churn": {
      const s = step(tile.commits, level.maxCommits);
      return s < 0 ? NEUTRAL : ramp(s);
    }
    case "dependents": {
      const s = step(tile.dependents, 100);
      return s < 0 ? NEUTRAL : ramp(s);
    }
    case "findings":
      if (tile.findings.high) return "var(--color-status-danger-solid)";
      if (tile.findings.medium) return "var(--color-status-warning-solid)";
      if (tile.findings.low || tile.findings.info) return "var(--color-status-info-solid)";
      return NEUTRAL;
    case "owner":
      return tile.singleOwner ? "var(--color-status-warning-solid)" : NEUTRAL;
  }
}

export interface LegendRow {
  color: string;
  label: string;
}

export function legend(lens: Lens, level: Pick<MapLevel, "languageRanks" | "maxCommits">): LegendRow[] {
  switch (lens) {
    case "language": {
      const named = level.languageRanks.slice(0, CATEGORY_COUNT - 1).map((language) => ({ color: languageColor(language, level.languageRanks), label: language }));
      return level.languageRanks.length > named.length ? [...named, { color: "var(--color-fg-muted)", label: "other" }] : named;
    }
    case "churn":
      return [{ color: NEUTRAL, label: "no commits" }, { color: ramp(0), label: "few" }, { color: ramp(STEPS.length - 1), label: `most (${level.maxCommits})` }];
    case "dependents":
      return [{ color: NEUTRAL, label: "not imported" }, { color: ramp(0), label: "low percentile" }, { color: ramp(STEPS.length - 1), label: "most imported" }];
    case "findings":
      return [
        { color: "var(--color-status-danger-solid)", label: "high" },
        { color: "var(--color-status-warning-solid)", label: "medium" },
        { color: "var(--color-status-info-solid)", label: "low or info" },
        { color: NEUTRAL, label: "none" },
      ];
    case "owner":
      return [{ color: "var(--color-status-warning-solid)", label: "one person made 80%+ of the changes" }, { color: NEUTRAL, label: "shared or no history" }];
  }
}
