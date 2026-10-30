import * as XLSX from "xlsx";
import { formatMarkdownTable } from "./table";
import type { DocumentParseOptions, DocumentParseResult } from "./model";

/**
 * Parses an Excel or OpenDocument spreadsheet buffer.
 */
export function parseSpreadsheet(
  bytes: Uint8Array,
  options: DocumentParseOptions
): DocumentParseResult {
  try {
    const workbook = XLSX.read(bytes, {
      type: "buffer",
      cellDates: true,
      dense: false,
    });

    const sheetNames = workbook.SheetNames || [];
    if (sheetNames.length === 0) {
      return {
        ok: true,
        content: `Document: ${options.path}\n[No sheets found in spreadsheet]`,
        format: "spreadsheet",
        sheets: [],
      };
    }

    const maxRows = options.maxRows && options.maxRows > 0 ? options.maxRows : 100;

    // Determine target sheet
    let targetSheetName = sheetNames[0];
    if (options.sheet !== undefined && options.sheet !== null) {
      if (typeof options.sheet === "number") {
        const idx = options.sheet >= 1 ? options.sheet - 1 : options.sheet;
        if (idx >= 0 && idx < sheetNames.length) {
          targetSheetName = sheetNames[idx];
        } else {
          return {
            ok: false,
            error: `Sheet index ${options.sheet} is out of range. Document has ${sheetNames.length} sheet(s): ${sheetNames.map((s, i) => `[${i + 1}] "${s}"`).join(", ")}`,
            sheets: sheetNames,
          };
        }
      } else {
        const query = String(options.sheet).trim().toLowerCase();
        const found = sheetNames.find(
          (s) => s.toLowerCase() === query || s.trim().toLowerCase() === query
        );
        if (found) {
          targetSheetName = found;
        } else {
          return {
            ok: false,
            error: `Sheet "${options.sheet}" not found. Available sheets: ${sheetNames.map((s) => `"${s}"`).join(", ")}`,
            sheets: sheetNames,
          };
        }
      }
    }

    const worksheet = workbook.Sheets[targetSheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      defval: "",
      raw: false,
    });

    const { table, rowCount, colCount } = formatMarkdownTable(rows, maxRows);

    const sections: string[] = [];
    sections.push(`# Spreadsheet: ${options.path}`);

    // If there are multiple sheets, list them with row counts
    if (sheetNames.length > 1) {
      sections.push("### Sheets in Workbook:");
      for (let i = 0; i < sheetNames.length; i++) {
        const name = sheetNames[i];
        const s = workbook.Sheets[name];
        const r = XLSX.utils.sheet_to_json<unknown[]>(s, { header: 1, defval: "" }).length;
        const currentTag = name === targetSheetName ? " **(currently viewing)**" : "";
        sections.push(`- [${i + 1}] **"${name}"** (${r} rows)${currentTag}`);
      }
      sections.push(
        `\n> To view another sheet, call \`open_document(path="${options.path}", sheet="<sheet_name>")\``
      );
    }

    sections.push(`\n## Sheet: "${targetSheetName}" (${rowCount} rows, ${colCount} columns)\n`);
    sections.push(table);

    if (rowCount > maxRows) {
      sections.push(
        `\n*[Showing rows 1-${maxRows} of ${rowCount}. To view more, call \`open_document(path="${options.path}", sheet="${targetSheetName}", maxRows=${Math.min(rowCount, maxRows + 200)})\`]*`
      );
    }

    return {
      ok: true,
      content: sections.join("\n"),
      format: "spreadsheet",
      sheets: sheetNames,
      activeSheet: targetSheetName,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to parse spreadsheet: ${message}` };
  }
}
