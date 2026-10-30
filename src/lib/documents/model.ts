// Document formats, the file-type checks, and the byte helpers shared by every parser.

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

export const SPREADSHEET_EXTS = new Set([".xlsx", ".xls", ".ods", ".xlsb", ".xlsm"]);
export const PDF_EXTS = new Set([".pdf"]);
export const WORD_EXTS = new Set([".docx"]);
export const DELIMITED_EXTS = new Set([".csv", ".tsv"]);
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

export function getExtension(path: string): string {
  const match = path.toLowerCase().match(/\.[a-z0-9]+$/);
  return match ? match[0] : "";
}

export function base64ToUint8Array(base64: string): Uint8Array {
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

export function toBuffer(uint8: Uint8Array): Buffer {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(uint8.buffer, uint8.byteOffset, uint8.byteLength);
  }
  return uint8 as unknown as Buffer;
}
