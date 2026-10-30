// ============================================================
// commandOutput/table.ts -- fixed-width tables as CLIs print them
// (`docker ps`, `docker images`): columns are found from the header (two
// or more spaces between titles), and a column can be dropped while the
// rest are re-aligned. Output that does not look like such a table is
// returned as undefined, so the caller leaves it alone.
// ============================================================

interface Column {
  title: string;
  start: number;
}

function columnsOf(header: string): Column[] {
  const columns: Column[] = [];
  const pattern = /\S+(?: \S+)*/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(header))) columns.push({ title: m[0], start: m.index });
  return columns;
}

/** `text` with the columns titled `drop` removed, or undefined when it is not a table that has them. */
export function dropColumns(text: string, drop: readonly string[]): string | undefined {
  const lines = text.split("\n").filter((line, i, all) => line.trim() !== "" || i < all.length - 1);
  if (lines.length < 2) return undefined;
  const columns = columnsOf(lines[0]);
  if (columns.length < 2 || !columns.some((column) => drop.includes(column.title))) return undefined;
  const rows = lines.map((line) => columns.map((column, i) => line.slice(column.start, columns[i + 1]?.start ?? line.length).trim()));
  const keep = columns.map((column, i) => (drop.includes(column.title) ? -1 : i)).filter((i) => i >= 0);
  const widths = keep.map((i) => Math.max(...rows.map((row) => row[i].length)));
  return rows
    .map((row) => keep.map((i, k) => (k === keep.length - 1 ? row[i] : row[i].padEnd(widths[k]))).join("   ").trimEnd())
    .join("\n");
}
