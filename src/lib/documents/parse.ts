import { base64ToUint8Array, getExtension, DELIMITED_EXTS, PDF_EXTS, SPREADSHEET_EXTS, WORD_EXTS, type DocumentParseOptions, type DocumentParseResult } from "./model";
import { documentClient } from "./client";
import { parseSpreadsheet } from "./spreadsheet";
import { parsePdf } from "./pdf";
import { parseWord } from "./word";
import { parseDelimited } from "./delimited";

/** Reads a file's base64 content through the custom reader when one is given, otherwise natively. */
function readBase64(path: string, customReader?: (path: string) => Promise<string>): Promise<string> {
  return customReader ? customReader(path) : documentClient.readBase64(path);
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
      const base64 = await readBase64(options.path, options.readFileBase64Fn);
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
