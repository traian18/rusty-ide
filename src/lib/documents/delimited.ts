import * as XLSX from "xlsx";
import { formatMarkdownTable } from "./table";
import type { DocumentParseOptions, DocumentParseResult } from "./model";

/**
 * Parses delimited text (CSV, TSV) using xlsx for clean table layout.
 */
export function parseDelimited(
  bytes: Uint8Array,
  options: DocumentParseOptions
): DocumentParseResult {
  try {
    const text = new TextDecoder("utf-8").decode(bytes);
    const maxRows = options.maxRows && options.maxRows > 0 ? options.maxRows : 100;
    const workbook = XLSX.read(text, { type: "string" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return {
        ok: true,
        content: text,
        format: "csv",
      };
    }
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: "" });
    const { table, rowCount, colCount } = formatMarkdownTable(rows, maxRows);

    const sections: string[] = [
      `# Delimited File: ${options.path} (${rowCount} rows, ${colCount} columns)\n`,
      table,
    ];
    if (rowCount > maxRows) {
      sections.push(`\n*[Showing rows 1-${maxRows} of ${rowCount}]*`);
    }

    return {
      ok: true,
      content: sections.join("\n"),
      format: "csv",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to parse CSV/TSV: ${message}` };
  }
}
