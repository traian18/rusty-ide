// ============================================================
// toolOutput/sections.ts -- how a tool's result divides into parts that
// can each be recognised as "already sent". Most tools are one part, keyed
// by the tool and its arguments; spec_context is a header (status and open
// tasks, always resent) followed by one part per document. A new tool with
// its own layout gets its own entry in SECTIONERS.
// ============================================================

export interface Section {
  /** What this part is, stable across calls: the same key and the same text is a repeat. */
  key: string;
  text: string;
  /** Never replaced, even when repeated (it is short or always current). */
  alwaysSend?: boolean;
}

type Sectioner = (output: string, args: unknown) => Section[];

const stableArgs = (args: unknown): string => {
  if (!args || typeof args !== "object") return "";
  const entries = Object.entries(args as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
};

const whole: Sectioner = (output, args) => [{ key: stableArgs(args), text: output }];

/** `## design (.rusty/specs/changes/0001-x/design.md)` starts a document. */
const DOCUMENT_HEADING = /^## \S+ \(.+\)$/;

const specContext: Sectioner = (output) => {
  const sections: Section[] = [];
  let current: Section = { key: "header", text: "", alwaysSend: true };
  for (const line of output.split("\n")) {
    if (DOCUMENT_HEADING.test(line)) {
      sections.push(current);
      current = { key: line, text: "" };
    }
    current.text += current.text ? `\n${line}` : line;
  }
  sections.push(current);
  return sections;
};

const SECTIONERS: Record<string, Sectioner> = { spec_context: specContext };

export function sectionsOf(tool: string, output: string, args: unknown): Section[] {
  return (SECTIONERS[tool] ?? whole)(output, args);
}
