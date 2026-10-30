import "./environment";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import type { DocumentParseOptions, DocumentParseResult } from "./model";

/**
 * Parses a PDF document buffer using pdfjs-dist legacy build.
 */
export async function parsePdf(
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
