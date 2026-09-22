import { describe, it, expect, vi } from "vitest";
import {
  buildAttachmentContext,
  MAX_ATTACHMENT_CHAR_LENGTH,
  type ContextAttachment,
} from "./contextAttachmentService";

describe("contextAttachmentService", () => {
  it("returns empty string when attachments list is empty or undefined", async () => {
    expect(await buildAttachmentContext([])).toBe("");
    expect(await buildAttachmentContext(undefined)).toBe("");
  });

  it("formats file context with file content", async () => {
    const mockReadFile = vi.fn().mockResolvedValue("console.log('hello world');");
    const attachments: ContextAttachment[] = [
      { path: "/Users/test/file.ts", name: "file.ts", isDir: false },
    ];

    const result = await buildAttachmentContext(attachments, mockReadFile);
    expect(mockReadFile).toHaveBeenCalledWith("/Users/test/file.ts");
    expect(result).toContain("<AttachedContext>");
    expect(result).toContain("--- Attached File Context: /Users/test/file.ts ---");
    expect(result).toContain("console.log('hello world');");
    expect(result).toContain("</AttachedContext>");
  });

  it("handles directory attachments cleanly", async () => {
    const mockReadFile = vi.fn();
    const attachments: ContextAttachment[] = [
      { path: "/Users/test/my-folder", name: "my-folder", isDir: true },
    ];

    const result = await buildAttachmentContext(attachments, mockReadFile);
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(result).toContain("--- Attached Directory Context: /Users/test/my-folder ---");
    expect(result).toContain("[Folder: my-folder]");
  });

  it("truncates files exceeding MAX_ATTACHMENT_CHAR_LENGTH", async () => {
    const oversizedContent = "a".repeat(MAX_ATTACHMENT_CHAR_LENGTH + 500);
    const mockReadFile = vi.fn().mockResolvedValue(oversizedContent);
    const attachments: ContextAttachment[] = [
      { path: "/Users/test/large.txt", name: "large.txt" },
    ];

    const result = await buildAttachmentContext(attachments, mockReadFile);
    expect(result).toContain("[Content truncated: showing first 100 KB");
    expect(result).toContain("Full file is available on disk at /Users/test/large.txt");
  });

  it("handles unreadable / error files gracefully", async () => {
    const mockReadFile = vi.fn().mockRejectedValue(new Error("Permission denied"));
    const attachments: ContextAttachment[] = [
      { path: "/Users/test/protected.key", name: "protected.key" },
    ];

    const result = await buildAttachmentContext(attachments, mockReadFile);
    expect(result).toContain("Unable to read content directly (Permission denied)");
    expect(result).toContain("Path is available on disk.");
  });

  it("parses attached binary document (Excel) into structured table", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["SKU", "Price"],
      ["ABC", 99],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Inventory");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const b64 = Buffer.from(buf).toString("base64");

    const mockReadFile = vi.fn().mockResolvedValue(b64);
    const attachments: ContextAttachment[] = [
      { path: "/Users/test/inventory.xlsx", name: "inventory.xlsx" },
    ];

    const result = await buildAttachmentContext(attachments, mockReadFile);
    expect(result).toContain("--- Attached File Context: /Users/test/inventory.xlsx ---");
    expect(result).toContain("# Spreadsheet: /Users/test/inventory.xlsx");
    expect(result).toContain("| SKU | Price |");
    expect(result).toContain("| ABC | 99 |");
  });
});
