import mammoth from "mammoth";
import { toBuffer, type DocumentParseOptions, type DocumentParseResult } from "./model";

/**
 * Parses a Word (.docx) document buffer using mammoth.
 */
export async function parseWord(
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
