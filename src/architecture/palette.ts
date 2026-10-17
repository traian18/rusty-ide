/**
 * Colours for nodes and for the bands that leave them. A band takes the colour of the node it
 * comes from (fading into the colour of the node it points at), so a line can be traced back to the
 * area it belongs to. Per-node colours come from the application's shared categorical palette
 * (`styles/categoricalColors.ts`), so they follow the theme. Pure.
 */
import { assignCategories, categoryVar } from "../styles/categoricalColors";

/** Palette slots 0-3 (language, kind), 10-13 (severity, high to info), -1 neutral. */
const TONE_COLORS = [
  "var(--color-primary)",
  "var(--color-status-success-solid)",
  "var(--color-status-info-solid)",
  "var(--color-status-warning-solid)",
] as const;
const SEVERITY_COLORS = [
  "var(--color-status-danger-solid)",
  "var(--color-status-warning-solid)",
  "var(--color-status-info-solid)",
  "var(--color-border-default)",
] as const;

export const NEUTRAL_COLOR = "var(--color-fg-muted)";
export const CYCLE_COLOR = "var(--color-status-danger-solid)";

export function toneColor(tone: number): string {
  if (tone < 0) return NEUTRAL_COLOR;
  if (tone >= 10) return SEVERITY_COLORS[tone - 10] ?? NEUTRAL_COLOR;
  return TONE_COLORS[tone % TONE_COLORS.length];
}

/** Category slots for the nodes of a level: distinct colours for the first twelve, stable by id. */
export function nodeSlots(ids: readonly string[]): Map<string, number> {
  return assignCategories(ids);
}

/** The colour of a node: its own category colour when each node is coloured separately, otherwise its tone. */
export function nodeColor(slot: number | undefined, tone: number, perNode: boolean, synthetic: boolean): string {
  if (synthetic) return NEUTRAL_COLOR;
  return perNode && slot !== undefined ? categoryVar(slot) : toneColor(tone);
}
