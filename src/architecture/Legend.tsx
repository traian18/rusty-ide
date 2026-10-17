import type { ColorBy, LegendEntry } from "./aggregate";
import styles from "./Architecture.module.css";

const TONE_CLASS = ["tone0", "tone1", "tone2", "tone3"] as const;
const SEVERITY_LABELS = ["High", "Medium", "Low", "Info"] as const;
const SEVERITY_CLASS = ["toneHigh", "toneMedium", "toneLow", "toneInfo"] as const;
const KIND_LEGEND: LegendEntry[] = [
  { label: "Package", tone: 0, count: 0 },
  { label: "Source root", tone: 1, count: 0 },
  { label: "Directory", tone: 2, count: 0 },
];

/** The legend for the current colouring, plus what size and line style mean. */
export function Legend({ colorBy, languages, frameworkOn = false }: { colorBy: ColorBy; languages: LegendEntry[]; frameworkOn?: boolean }) {
  const entries: { label: string; className: string }[] =
    colorBy === "node"
      ? []
      : colorBy === "language"
      ? languages.map((entry) => ({ label: `${entry.label} (${entry.count})`, className: styles[TONE_CLASS[entry.tone % TONE_CLASS.length]] }))
      : colorBy === "kind"
        ? KIND_LEGEND.map((entry) => ({ label: entry.label, className: styles[TONE_CLASS[entry.tone]] }))
        : SEVERITY_LABELS.map((label, index) => ({ label: `${label} findings`, className: styles[SEVERITY_CLASS[index]] }));
  return (
    <div className={styles.legend} aria-label="Legend">
      {entries.map((entry) => (
        <span key={entry.label} className={styles.legendItem}>
          <span className={`${styles.swatch} ${entry.className}`} aria-hidden /> {entry.label}
        </span>
      ))}
      {colorBy === "node" ? <span>Each package has its own colour; a line starts in the colour of the package it comes from.</span> : null}
      {frameworkOn ? <span>Dotted lines with arrows: framework relations (routes, injections, renders, commands)</span> : null}
      <span>Size: files · line width: imports · dashed: type-only · red: import cycle</span>
    </div>
  );
}
