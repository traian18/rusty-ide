// Renders spreadsheet and delimited rows as a Markdown table.

/**
 * Formats a 2D array of cells into a clean Markdown table.
 */
export function formatMarkdownTable(rows: unknown[][], maxRows: number): { table: string; rowCount: number; colCount: number } {
  if (rows.length === 0) {
    return { table: "*[Empty table]*", rowCount: 0, colCount: 0 };
  }

  // Find max columns with data
  let colCount = 0;
  for (const row of rows) {
    if (Array.isArray(row)) {
      colCount = Math.max(colCount, row.length);
    }
  }
  if (colCount === 0) {
    return { table: "*[Empty table]*", rowCount: 0, colCount: 0 };
  }

  const escapeCell = (val: unknown): string => {
    if (val === null || val === undefined) return "";
    let str: string;
    if (val instanceof Date) {
      str = val.toISOString().slice(0, 10);
    } else {
      str = String(val);
    }
    // Clean up internal linebreaks and escape pipes
    return str.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
  };

  const headerRow = (rows[0] as unknown[]) || [];
  const headerCells: string[] = [];
  for (let c = 0; c < colCount; c++) {
    const rawVal = escapeCell(headerRow[c]);
    headerCells.push(rawVal || `Col ${c + 1}`);
  }

  const tableLines: string[] = [];
  tableLines.push(`| ${headerCells.join(" | ")} |`);
  tableLines.push(`| ${headerCells.map(() => "---").join(" | ")} |`);

  const dataRows = rows.slice(1, 1 + maxRows);
  for (const row of dataRows) {
    const cells: string[] = [];
    for (let c = 0; c < colCount; c++) {
      const cellVal = Array.isArray(row) ? escapeCell(row[c]) : "";
      cells.push(cellVal);
    }
    tableLines.push(`| ${cells.join(" | ")} |`);
  }

  return {
    table: tableLines.join("\n"),
    rowCount: rows.length,
    colCount,
  };
}
