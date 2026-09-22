/**
 * documentParserService.ts
 *
 * Provides cross-platform parsing and text/markdown extraction for:
 * - Spreadsheets: Excel (.xlsx, .xls, .ods, .xlsb, .xlsm), CSV, TSV
 * - PDF documents (.pdf)
 * - Word documents (.docx)
 * - Plain text and delimited documents
 *
 * Designed for use by AI agent tools (open_document, read_file) and context attachment parsing.
 */

import { invoke } from "@tauri-apps/api/core";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import * as pdfWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";

// Ensure Promise.withResolvers is available (standard in ES2024, polyfilled for older WebKit / Safari)
if (typeof (Promise as unknown as { withResolvers?: unknown }).withResolvers === "undefined") {
  (Promise as unknown as { withResolvers: <T>() => { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void; reject: (reason?: unknown) => void } }).withResolvers = function <T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// Ensure ReadableStream supports async iteration (for-await-of) across all WebKit / Safari engines
if (typeof ReadableStream !== "undefined" && !(Symbol.asyncIterator in ReadableStream.prototype)) {
  (ReadableStream.prototype as any)[Symbol.asyncIterator] = async function* (this: ReadableStream) {
    const reader = this.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  };
}

// Ensure PDF.js worker is registered in all environments (browser/Tauri webview and Node)
// so it never fails with 'No "GlobalWorkerOptions.workerSrc" specified.'
if (typeof globalThis !== "undefined") {
  (globalThis as unknown as { pdfjsWorker?: unknown }).pdfjsWorker = pdfWorker;
}
if (pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "./pdf.worker.mjs";
}

export type DocumentFormat = "spreadsheet" | "pdf" | "word" | "csv" | "text";

export interface DocumentParseOptions {
  path: string;
  base64Data?: string;
  buffer?: Uint8Array | ArrayBuffer | Buffer;
  sheet?: string | number;
  page?: number;
  maxRows?: number;
  maxPages?: number;
  readFileBase64Fn?: (path: string) => Promise<string>;
}

export interface DocumentParseResult {
  ok: boolean;
  content?: string;
  format?: DocumentFormat;
  error?: string;
  pageCount?: number;
  sheets?: string[];
  activeSheet?: string;
}

const SPREADSHEET_EXTS = new Set([".xlsx", ".xls", ".ods", ".xlsb", ".xlsm"]);
const PDF_EXTS = new Set([".pdf"]);
const WORD_EXTS = new Set([".docx"]);
const DELIMITED_EXTS = new Set([".csv", ".tsv"]);
const TEXT_EXTS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".yaml",
  ".yml",
  ".xml",
  ".html",
  ".log",
  ".rtf",
]);

/**
 * Checks if a file path matches known document formats.
 */
export function isDocumentFile(path: string): boolean {
  const ext = getExtension(path);
  return (
    SPREADSHEET_EXTS.has(ext) ||
    PDF_EXTS.has(ext) ||
    WORD_EXTS.has(ext) ||
    DELIMITED_EXTS.has(ext) ||
    TEXT_EXTS.has(ext)
  );
}

/**
 * Checks if a file path is a binary document format (requiring special parsing
 * rather than simple UTF-8 text reading).
 */
export function isBinaryDocumentFile(path: string): boolean {
  const ext = getExtension(path);
  return SPREADSHEET_EXTS.has(ext) || PDF_EXTS.has(ext) || WORD_EXTS.has(ext);
}

function getExtension(path: string): string {
  const match = path.toLowerCase().match(/\.[a-z0-9]+$/);
  return match ? match[0] : "";
}

function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function toBuffer(uint8: Uint8Array): Buffer {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(uint8.buffer, uint8.byteOffset, uint8.byteLength);
  }
  return uint8 as unknown as Buffer;
}

/**
 * Safely reads a binary file as base64 from Tauri or a custom reader.
 */
async function readBinaryBase64(
  path: string,
  customReader?: (path: string) => Promise<string>
): Promise<string> {
  if (customReader) {
    return customReader(path);
  }
  // Try read_binary_file_base64 first (100MB limit), fall back to read_file_as_base64
  try {
    return await invoke<string>("read_binary_file_base64", { path });
  } catch (err: unknown) {
    try {
      return await invoke<string>("read_file_as_base64", { path });
    } catch {
      throw err;
    }
  }
}

/**
 * Formats a 2D array of cells into a clean Markdown table.
 */
function formatMarkdownTable(rows: unknown[][], maxRows: number): { table: string; rowCount: number; colCount: number } {
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

/**
 * Parses an Excel or OpenDocument spreadsheet buffer.
 */
function parseSpreadsheet(
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

/**
 * Parses a PDF document buffer using pdfjs-dist legacy build.
 */
async function parsePdf(
  bytes: Uint8Array,
  options: DocumentParseOptions
): Promise<DocumentParseResult> {
  try {
    const loadingTask = pdfjsLib.getDocument({
      data: bytes,
      useWorkerFetch: false,
      useSystemFonts: true,
    });

    const pdfDoc = await loadingTask.promise;
    const numPages = pdfDoc.numPages;

    if (numPages === 0) {
      return {
        ok: true,
        content: `Document: ${options.path}\n[PDF contains 0 pages]`,
        format: "pdf",
        pageCount: 0,
      };
    }

    // Specific page requested
    if (options.page !== undefined && options.page !== null) {
      const pageNum = Number(options.page);
      if (isNaN(pageNum) || pageNum < 1 || pageNum > numPages) {
        return {
          ok: false,
          error: `Requested page ${options.page} is out of bounds (document has ${numPages} pages).`,
          pageCount: numPages,
        };
      }

      const pageText = await extractPageText(pdfDoc, pageNum);
      const content = `# PDF Document: ${options.path}\n\n## Page ${pageNum} of ${numPages}\n\n${pageText || "*[Empty page or image-only content]*"}`;

      return {
        ok: true,
        content,
        format: "pdf",
        pageCount: numPages,
      };
    }

    // All pages up to maxPages
    const maxPages = options.maxPages && options.maxPages > 0 ? options.maxPages : 20;
    const pagesToRead = Math.min(numPages, maxPages);
    const pageOutputs: string[] = [];

    for (let p = 1; p <= pagesToRead; p++) {
      const pageText = await extractPageText(pdfDoc, p);
      pageOutputs.push(
        `--- Page ${p} of ${numPages} ---\n${pageText || "*[Empty page or image-only content]*"}`
      );
    }

    const sections: string[] = [];
    sections.push(`# PDF Document: ${options.path}`);
    sections.push(`Total Pages: ${numPages}\n`);
    sections.push(pageOutputs.join("\n\n"));

    if (numPages > maxPages) {
      sections.push(
        `\n\n*[Showing pages 1-${maxPages} of ${numPages}. To view remaining pages, call \`open_document(path="${options.path}", page=<page_number>)\`]*`
      );
    }

    return {
      ok: true,
      content: sections.join("\n"),
      format: "pdf",
      pageCount: numPages,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to parse PDF: ${message}` };
  }
}

/**
 * Extracts formatted text from a single PDF page.
 */
async function extractPageText(
  pdfDoc: { getPage: (n: number) => Promise<any> },
  pageNum: number
): Promise<string> {
  const page = await pdfDoc.getPage(pageNum);
  let textContent: { items: unknown[] };

  try {
    textContent = await page.getTextContent();
  } catch (err: unknown) {
    // If getTextContent fails due to stream async iteration in WebKit or other engines,
    // directly read from streamTextContent() using reader
    if (typeof page.streamTextContent === "function") {
      const stream = page.streamTextContent();
      const items: unknown[] = [];
      if (stream && typeof stream.getReader === "function") {
        const reader = stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value && Array.isArray(value.items)) {
              items.push(...value.items);
            }
          }
        } finally {
          reader.releaseLock();
        }
      }
      textContent = { items };
    } else {
      throw err;
    }
  }

  const lines: string[] = [];
  let currentLine = "";
  let lastY: number | null = null;

  for (const item of textContent.items) {
    if (item && typeof item === "object" && "str" in item) {
      const textItem = item as { str: string; hasEOL?: boolean; transform?: number[] };
      const y = Array.isArray(textItem.transform) ? textItem.transform[5] : null;

      // When vertical Y position changes significantly, advance to next line
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 5) {
        if (currentLine.trim().length > 0) {
          lines.push(currentLine.trim());
          currentLine = "";
        }
      }

      const str = textItem.str;
      if (str) {
        if (currentLine.length > 0 && !currentLine.endsWith(" ") && !str.startsWith(" ")) {
          currentLine += " ";
        }
        currentLine += str;
      }

      if (textItem.hasEOL) {
        if (currentLine.trim().length > 0) {
          lines.push(currentLine.trim());
          currentLine = "";
        }
      }

      if (y !== null) {
        lastY = y;
      }
    }
  }

  if (currentLine.trim().length > 0) {
    lines.push(currentLine.trim());
  }

  return lines.join("\n");
}

/**
 * Parses a Word (.docx) document buffer using mammoth.
 */
async function parseWord(
  bytes: Uint8Array,
  options: DocumentParseOptions
): Promise<DocumentParseResult> {
  try {
    const buffer = toBuffer(bytes);
    let markdown = "";
    try {
      const mammothAny = mammoth as unknown as {
        convertToMarkdown?: (input: { buffer: Buffer }) => Promise<{ value: string }>;
      };
      if (typeof mammothAny.convertToMarkdown === "function") {
        const mdResult = await mammothAny.convertToMarkdown({ buffer });
        markdown = mdResult.value?.trim() || "";
      }
    } catch {
      markdown = "";
    }

    // Fallback to raw text extraction if markdown is empty
    if (!markdown) {
      const rawResult = await mammoth.extractRawText({ buffer });
      markdown = rawResult.value?.trim() || "";
    }

    if (!markdown) {
      markdown = "*[Empty document]*";
    }

    return {
      ok: true,
      content: `# Word Document: ${options.path}\n\n${markdown}`,
      format: "word",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to parse Word document: ${message}` };
  }
}

/**
 * Parses delimited text (CSV, TSV) using xlsx for clean table layout.
 */
function parseDelimited(
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

/**
 * Main entry point: Loads and parses a document from path, base64Data, or buffer.
 */
export async function parseDocument(
  options: DocumentParseOptions
): Promise<DocumentParseResult> {
  const ext = getExtension(options.path);

  let bytes: Uint8Array;
  if (options.buffer) {
    if (options.buffer instanceof Uint8Array) {
      bytes = options.buffer;
    } else if (options.buffer instanceof ArrayBuffer) {
      bytes = new Uint8Array(options.buffer);
    } else {
      bytes = new Uint8Array(options.buffer);
    }
  } else if (options.base64Data) {
    bytes = base64ToUint8Array(options.base64Data);
  } else {
    try {
      const base64 = await readBinaryBase64(options.path, options.readFileBase64Fn);
      bytes = base64ToUint8Array(base64);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Could not read file "${options.path}": ${message}` };
    }
  }

  // Handle format by extension
  if (SPREADSHEET_EXTS.has(ext)) {
    return parseSpreadsheet(bytes, options);
  }

  if (PDF_EXTS.has(ext)) {
    return parsePdf(bytes, options);
  }

  if (WORD_EXTS.has(ext)) {
    return parseWord(bytes, options);
  }

  if (DELIMITED_EXTS.has(ext)) {
    return parseDelimited(bytes, options);
  }

  // Fallback: UTF-8 text decode
  try {
    const text = new TextDecoder("utf-8").decode(bytes);
    return {
      ok: true,
      content: text,
      format: "text",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to decode text document: ${message}` };
  }
}
