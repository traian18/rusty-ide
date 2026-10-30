// ============================================================
// filters/files/ls.ts -- `ls`. A long listing (-l, -la, -lh) keeps each
// entry's mode, size and name and drops the link count, owner, group,
// date, `total` and the `.`/`..` entries; directories get a trailing `/`.
// Any listing is capped per directory. A line the long-format parser does
// not recognise leaves the listing as it was.
// ============================================================

import { hasShortFlag } from "../../invocation";
import { capList, humanSize, plural } from "../../text";
import type { CommandFilter } from "../../types";

const MAX_ENTRIES_PER_DIRECTORY = 150;

const DATE = String.raw`(?:\w{3}\s+\d{1,2}\s+(?:\d{1,2}:\d{2}|\d{4})|\d{1,2}\s+\w{3}\s+(?:\d{1,2}:\d{2}|\d{4})|\d{4}-\d\d-\d\d(?:\s+\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:\s+[+-]\d{4})?)?)`;
const LONG_ENTRY = new RegExp(String.raw`^([-dlcbpsD][rwxsStT-]{9})[@+.]?\s+\d+\s+\S+\s+\S+\s+([\d.,]+[KMGTPB]?|\d+,\s*\d+)\s+${DATE}\s(.+)$`);

interface Section {
  header: string[];
  entries: string[];
}

function sectionsOf(output: string): Section[] {
  const sections: Section[] = [{ header: [], entries: [] }];
  for (const line of output.split("\n")) {
    if (line.trim() === "") continue;
    if (/^\S.*:$/.test(line) && !LONG_ENTRY.test(line)) sections.push({ header: [line], entries: [] });
    else sections[sections.length - 1].entries.push(line);
  }
  return sections.filter((section) => section.header.length > 0 || section.entries.length > 0);
}

/** One long-format entry as `mode  size  name`, or null to drop it, or undefined when it does not parse. */
function shortEntry(line: string): string | null | undefined {
  if (/^total \d/.test(line)) return null;
  const m = LONG_ENTRY.exec(line);
  if (!m) return undefined;
  const [, mode, size, name] = m;
  if (name === "." || name === "..") return null;
  const isDirectory = mode.startsWith("d");
  const shownSize = isDirectory ? "-" : /^\d+$/.test(size) ? humanSize(Number(size)) : size;
  return `${mode}  ${shownSize.padStart(5)}  ${name}${isDirectory && !name.endsWith("/") ? "/" : ""}`;
}

export const lsFilter: CommandFilter = {
  name: "ls",
  matches: (command) => command.tool === "ls",
  apply: (output, command) => {
    const long = hasShortFlag(command, "l") || hasShortFlag(command, "g") || hasShortFlag(command, "o");
    const out: string[] = [];
    const sections = sectionsOf(output);
    for (const [i, section] of sections.entries()) {
      let entries = section.entries;
      if (long) {
        const shortened = entries.map(shortEntry);
        if (shortened.some((entry) => entry === undefined)) return undefined;
        entries = shortened.filter((entry): entry is string => entry !== null);
      }
      if (i > 0) out.push("");
      out.push(...section.header, ...capList(entries, MAX_ENTRIES_PER_DIRECTORY, (hidden) => `... ${plural(hidden, "more entry", "more entries")}`));
    }
    return out.join("\n");
  },
};
