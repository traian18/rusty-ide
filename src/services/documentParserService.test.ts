import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  isDocumentFile,
  isBinaryDocumentFile,
  parseDocument,
} from "./documentParserService";

// Helper to generate minimal valid 1-page PDF
function createMinimalPdfBuffer(): Uint8Array {
  const minimalPdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 55 >> stream
BT
/F1 18 Tf
10 100 Td
(Quarterly Revenue Report) Tj
ET
endstream
endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000010 00000 n 
0000000060 00000 n 
0000000117 00000 n 
0000000227 00000 n 
0000000334 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
408
%%EOF`;
  return new Uint8Array(Buffer.from(minimalPdf));
}

// Helper to generate an Excel workbook buffer
function createExcelWorkbookBuffer(sheets: Record<string, unknown[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [sheetName, data] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return new Uint8Array(buf);
}

describe("documentParserService", () => {
  describe("isDocumentFile and isBinaryDocumentFile", () => {
    it("recognizes spreadsheet formats", () => {
      expect(isDocumentFile("financials.xlsx")).toBe(true);
      expect(isDocumentFile("report.XLS")).toBe(true);
      expect(isDocumentFile("data.ods")).toBe(true);
      expect(isBinaryDocumentFile("financials.xlsx")).toBe(true);
    });

    it("recognizes PDF formats", () => {
      expect(isDocumentFile("/path/to/invoice.pdf")).toBe(true);
      expect(isBinaryDocumentFile("/path/to/invoice.pdf")).toBe(true);
    });

    it("recognizes Word documents", () => {
      expect(isDocumentFile("spec.docx")).toBe(true);
      expect(isBinaryDocumentFile("spec.docx")).toBe(true);
    });

    it("recognizes CSV/TSV as text documents, not binary", () => {
      expect(isDocumentFile("data.csv")).toBe(true);
      expect(isBinaryDocumentFile("data.csv")).toBe(false);
    });

    it("returns false for non-document formats", () => {
      expect(isDocumentFile("main.rs")).toBe(false);
      expect(isDocumentFile("image.png")).toBe(false);
      expect(isBinaryDocumentFile("package.json")).toBe(false);
    });
  });

  describe("Excel spreadsheet parsing", () => {
    it("parses single sheet workbook into markdown table", async () => {
      const excelBuffer = createExcelWorkbookBuffer({
        Revenue: [
          ["Region", "Q1", "Q2", "Q3"],
          ["North America", 120000, 135000, 142000],
          ["Europe", 98000, 102000, 109000],
        ],
      });

      const result = await parseDocument({
        path: "revenue.xlsx",
        buffer: excelBuffer,
      });

      expect(result.ok).toBe(true);
      expect(result.format).toBe("spreadsheet");
      expect(result.sheets).toEqual(["Revenue"]);
      expect(result.content).toContain("# Spreadsheet: revenue.xlsx");
      expect(result.content).toContain('## Sheet: "Revenue"');
      expect(result.content).toContain("| Region | Q1 | Q2 | Q3 |");
      expect(result.content).toContain("| North America | 120000 | 135000 | 142000 |");
      expect(result.content).toContain("| Europe | 98000 | 102000 | 109000 |");
    });

    it("lists all sheets and displays first sheet when multiple sheets exist", async () => {
      const excelBuffer = createExcelWorkbookBuffer({
        Summary: [
          ["Metric", "Value"],
          ["Total Users", 5000],
        ],
        Details: [
          ["ID", "Name", "Active"],
          [1, "Alice", true],
          [2, "Bob", false],
        ],
      });

      const result = await parseDocument({
        path: "metrics.xlsx",
        buffer: excelBuffer,
      });

      expect(result.ok).toBe(true);
      expect(result.sheets).toEqual(["Summary", "Details"]);
      expect(result.content).toContain("### Sheets in Workbook:");
      expect(result.content).toContain('[1] **"Summary"** (2 rows) **(currently viewing)**');
      expect(result.content).toContain('[2] **"Details"** (3 rows)');
      expect(result.content).toContain('## Sheet: "Summary"');
      expect(result.content).toContain("| Metric | Value |");
      expect(result.content).toContain("| Total Users | 5000 |");
    });

    it("can select a specific sheet by name", async () => {
      const excelBuffer = createExcelWorkbookBuffer({
        Summary: [["A", "B"]],
        Details: [
          ["ID", "Name"],
          [1, "Alice"],
        ],
      });

      const result = await parseDocument({
        path: "metrics.xlsx",
        buffer: excelBuffer,
        sheet: "Details",
      });

      expect(result.ok).toBe(true);
      expect(result.activeSheet).toBe("Details");
      expect(result.content).toContain('## Sheet: "Details"');
      expect(result.content).toContain("| ID | Name |");
      expect(result.content).toContain("| 1 | Alice |");
    });

    it("can select a sheet by 1-based index", async () => {
      const excelBuffer = createExcelWorkbookBuffer({
        SheetOne: [["Col1"], ["Val1"]],
        SheetTwo: [["Col2"], ["Val2"]],
      });

      const result = await parseDocument({
        path: "test.xlsx",
        buffer: excelBuffer,
        sheet: 2,
      });

      expect(result.ok).toBe(true);
      expect(result.activeSheet).toBe("SheetTwo");
      expect(result.content).toContain('## Sheet: "SheetTwo"');
      expect(result.content).toContain("| Val2 |");
    });

    it("returns a descriptive error when requested sheet does not exist", async () => {
      const excelBuffer = createExcelWorkbookBuffer({
        Overview: [["Col1"]],
      });

      const result = await parseDocument({
        path: "test.xlsx",
        buffer: excelBuffer,
        sheet: "NonExistent",
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Sheet "NonExistent" not found');
      expect(result.error).toContain('Available sheets: "Overview"');
    });

    it("respects maxRows cap and adds note when truncated", async () => {
      const rows: unknown[][] = [["Number"]];
      for (let i = 1; i <= 25; i++) {
        rows.push([`Item ${i}`]);
      }
      const excelBuffer = createExcelWorkbookBuffer({ Items: rows });

      const result = await parseDocument({
        path: "items.xlsx",
        buffer: excelBuffer,
        maxRows: 5,
      });

      expect(result.ok).toBe(true);
      expect(result.content).toContain("| Item 5 |");
      expect(result.content).not.toContain("| Item 6 |");
      expect(result.content).toContain("Showing rows 1-5 of 26");
    });
  });

  describe("PDF parsing", () => {
    it("extracts text from PDF document", async () => {
      const pdfBuffer = createMinimalPdfBuffer();

      const result = await parseDocument({
        path: "report.pdf",
        buffer: pdfBuffer,
      });

      expect(result.ok).toBe(true);
      expect(result.format).toBe("pdf");
      expect(result.pageCount).toBe(1);
      expect(result.content).toContain("Quarterly Revenue Report");
      expect(result.content).toContain("--- Page 1 of 1 ---");
    });

    it("extracts specific page when page option is passed", async () => {
      const pdfBuffer = createMinimalPdfBuffer();

      const result = await parseDocument({
        path: "report.pdf",
        buffer: pdfBuffer,
        page: 1,
      });

      expect(result.ok).toBe(true);
      expect(result.content).toContain("## Page 1 of 1");
      expect(result.content).toContain("Quarterly Revenue Report");
    });

    it("returns clean error when requested page is out of bounds", async () => {
      const pdfBuffer = createMinimalPdfBuffer();

      const result = await parseDocument({
        path: "report.pdf",
        buffer: pdfBuffer,
        page: 5,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain("Requested page 5 is out of bounds");
    });

    it("successfully parses PDF in a browser-like environment with window defined without workerSrc errors", async () => {
      const originalWindow = (globalThis as unknown as { window?: unknown }).window;
      try {
        (globalThis as unknown as { window: unknown }).window = globalThis;
        const pdfBuffer = createMinimalPdfBuffer();
        const result = await parseDocument({
          path: "browser_test.pdf",
          buffer: pdfBuffer,
        });
        expect(result.ok).toBe(true);
        expect(result.content).toContain("Quarterly Revenue Report");
      } finally {
        if (originalWindow === undefined) {
          delete (globalThis as unknown as { window?: unknown }).window;
        } else {
          (globalThis as unknown as { window: unknown }).window = originalWindow;
        }
      }
    });

    it("handles WebKit stream asyncIterator absence cleanly", async () => {
      const pdfBuffer = createMinimalPdfBuffer();
      const originalAsyncIterator = (ReadableStream.prototype as unknown as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator];
      try {
        delete (ReadableStream.prototype as unknown as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator];

        const result = await parseDocument({
          path: "webkit_stream_test.pdf",
          buffer: pdfBuffer,
        });
        expect(result.ok).toBe(true);
        expect(result.content).toContain("Quarterly Revenue Report");
      } finally {
        if (originalAsyncIterator) {
          (ReadableStream.prototype as unknown as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] = originalAsyncIterator;
        }
      }
    });
  });

  describe("CSV parsing", () => {
    it("formats CSV into a Markdown table", async () => {
      const csvData = "Name,Department,Salary\nAlice,Engineering,120000\nBob,Marketing,95000";
      const buffer = new TextEncoder().encode(csvData);

      const result = await parseDocument({
        path: "staff.csv",
        buffer,
      });

      expect(result.ok).toBe(true);
      expect(result.format).toBe("csv");
      expect(result.content).toContain("| Name | Department | Salary |");
      expect(result.content).toContain("| Alice | Engineering | 120000 |");
      expect(result.content).toContain("| Bob | Marketing | 95000 |");
    });
  });

  describe("Plain text fallback", () => {
    it("returns plain text for text files", async () => {
      const text = "Hello from a plain text file!\nLine 2";
      const buffer = new TextEncoder().encode(text);

      const result = await parseDocument({
        path: "notes.txt",
        buffer,
      });

      expect(result.ok).toBe(true);
      expect(result.format).toBe("text");
      expect(result.content).toBe(text);
    });
  });

  describe("File reading and error handling", () => {
    it("reads via custom readFileBase64Fn when provided", async () => {
      const csvData = "col1,col2\nval1,val2";
      const b64 = Buffer.from(csvData).toString("base64");
      const mockReader = async (_path: string) => b64;

      const result = await parseDocument({
        path: "external.csv",
        readFileBase64Fn: mockReader,
      });

      expect(result.ok).toBe(true);
      expect(result.content).toContain("| col1 | col2 |");
    });

    it("returns error if file reader rejects", async () => {
      const mockReader = async (_path: string) => {
        throw new Error("File not found");
      };

      const result = await parseDocument({
        path: "missing.xlsx",
        readFileBase64Fn: mockReader,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Could not read file "missing.xlsx"');
      expect(result.error).toContain("File not found");
    });
  });
});
