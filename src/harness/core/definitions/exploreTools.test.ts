import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { searchService } from "../../../services/searchService";
import type { RunHost } from "../../contract";
import {
  listFilesTool,
  openDocumentTool,
  readTool,
  searchCodebaseTool,
  writeTool,
} from "./exploreTools";
import * as XLSX from "xlsx";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../../services/searchService", () => ({ searchService: { searchProject: vi.fn() } }));

const invokeMock = vi.mocked(invoke);
const searchProjectMock = vi.mocked(searchService.searchProject);

function fakeHost(overrides: Partial<RunHost> = {}): RunHost {
  return {
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined),
    requestPermission: vi.fn(),
    ...overrides,
  };
}

const signal = new AbortController().signal;

describe("readTool", () => {
  it("resolves a relative path against workspaceRoot before reading", async () => {
    const readFile = vi.fn().mockResolvedValue("file contents");
    const tool = readTool("/workspace", fakeHost({ readFile }));
    const outcome = await tool({ path: "src/a.ts" }, signal);
    expect(readFile).toHaveBeenCalledWith("/workspace/src/a.ts", signal);
    expect(outcome).toEqual({ ok: true, output: "file contents" });
  });

  it("passes an already-absolute path through unchanged", async () => {
    const readFile = vi.fn().mockResolvedValue("x");
    const tool = readTool("/workspace", fakeHost({ readFile }));
    await tool({ path: "/elsewhere/b.ts" }, signal);
    expect(readFile).toHaveBeenCalledWith("/elsewhere/b.ts", signal);
  });

  it("returns a friendly placeholder, not an error, when the file doesn't exist", async () => {
    const readFile = vi.fn().mockRejectedValue(new Error("File not found on physical disk: /workspace/missing.ts"));
    const tool = readTool("/workspace", fakeHost({ readFile }));
    const outcome = await tool({ path: "missing.ts" }, signal);
    expect(outcome).toEqual({ ok: true, output: expect.stringContaining("does not exist yet") });
  });

  it("returns a friendly guard, not an error, when the path is a directory", async () => {
    const readFile = vi.fn().mockRejectedValue(new Error("Is a directory (os error 21)"));
    const tool = readTool("/workspace", fakeHost({ readFile }));
    const outcome = await tool({ path: "src" }, signal);
    expect(outcome).toEqual({ ok: true, output: expect.stringContaining("use list_files") });
  });

  it("surfaces any other read failure as a real tool error", async () => {
    const readFile = vi.fn().mockRejectedValue(new Error("permission denied"));
    const tool = readTool("/workspace", fakeHost({ readFile }));
    const outcome = await tool({ path: "a.ts" }, signal);
    expect(outcome).toEqual({ ok: false, error: "permission denied" });
  });

  it("resolves a bare filename to an external connected input file", async () => {
    const readFile = vi.fn().mockResolvedValue("external content");
    const inputFiles = [{ path: "/external/dir/my_doc.txt", name: "my_doc.txt" }];
    const tool = readTool("/workspace", fakeHost({ readFile }), inputFiles);
    const outcome = await tool({ path: "my_doc.txt" }, signal);
    expect(readFile).toHaveBeenCalledWith("/external/dir/my_doc.txt", signal);
    expect(outcome).toEqual({ ok: true, output: "external content" });
  });

  it("passes through a home-directory tilde path without prepending workspaceRoot", async () => {
    const readFile = vi.fn().mockResolvedValue("home content");
    const tool = readTool("/workspace", fakeHost({ readFile }));
    const outcome = await tool({ path: "~/notes.md" }, signal);
    expect(readFile).toHaveBeenCalledWith("~/notes.md", signal);
    expect(outcome).toEqual({ ok: true, output: "home content" });
  });
});
describe("writeTool", () => {
  it("resolves a relative path, writes it, and records it in modifiedFiles on success", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const modifiedFiles = new Set<string>();
    const tool = writeTool("/workspace", fakeHost({ writeFile }), modifiedFiles);
    const outcome = await tool({ path: "src/a.ts", content: "export {}" }, signal);
    expect(writeFile).toHaveBeenCalledWith("/workspace/src/a.ts", "export {}", signal);
    expect(outcome).toEqual({ ok: true, output: expect.stringContaining("/workspace/src/a.ts") });
    expect(modifiedFiles).toEqual(new Set(["/workspace/src/a.ts"]));
  });

  it("passes an already-absolute path through unchanged", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const modifiedFiles = new Set<string>();
    const tool = writeTool("/workspace", fakeHost({ writeFile }), modifiedFiles);
    await tool({ path: "/elsewhere/b.ts", content: "x" }, signal);
    expect(writeFile).toHaveBeenCalledWith("/elsewhere/b.ts", "x", signal);
  });

  it("does not record a failed write in modifiedFiles -- unlike the sidecar's own unconditional add", async () => {
    const writeFile = vi.fn().mockRejectedValue(new Error("disk full"));
    const modifiedFiles = new Set<string>();
    const tool = writeTool("/workspace", fakeHost({ writeFile }), modifiedFiles);
    const outcome = await tool({ path: "a.ts", content: "x" }, signal);
    expect(outcome).toEqual({ ok: false, error: "disk full" });
    expect(modifiedFiles.size).toBe(0);
  });
});

describe("listFilesTool", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("summarizes the directory tree returned by get_directory_structure", async () => {
    invokeMock.mockResolvedValue([
      {
        name: "src",
        path: "/workspace/src",
        is_dir: true,
        children: [
          { name: "a.ts", path: "/workspace/src/a.ts", is_dir: false },
          { name: "b.ts", path: "/workspace/src/b.ts", is_dir: false },
        ],
      },
      { name: "README.md", path: "/workspace/README.md", is_dir: false },
    ]);
    const tool = listFilesTool("/workspace");
    const outcome = await tool(undefined, signal);
    expect(invokeMock).toHaveBeenCalledWith("get_directory_structure", { rootDir: "/workspace" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.output).toContain("Total: 3 files, 1 directories");
    expect(outcome.output).toContain("src/ (2 files)");
    expect(outcome.output).toContain(".ts: 2 files");
    expect(outcome.output).toContain("src/a.ts");
  });

  it("skips ignored directories entirely", async () => {
    invokeMock.mockResolvedValue([
      { name: "node_modules", path: "/workspace/node_modules", is_dir: true, children: [{ name: "x.js", path: "/workspace/node_modules/x.js", is_dir: false }] },
      { name: "index.ts", path: "/workspace/index.ts", is_dir: false },
    ]);
    const tool = listFilesTool("/workspace");
    const outcome = await tool(undefined, signal);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.output).toContain("Total: 1 files, 0 directories");
    expect(outcome.output).not.toContain("node_modules");
  });

  it("reports a failed invoke as an error outcome", async () => {
    invokeMock.mockRejectedValue(new Error("no such directory"));
    const tool = listFilesTool("/workspace");
    const outcome = await tool(undefined, signal);
    expect(outcome).toEqual({ ok: false, error: "no such directory" });
  });
});

describe("searchCodebaseTool", () => {
  beforeEach(() => {
    searchProjectMock.mockReset();
  });

  it("searches with a case-insensitive regex and formats content matches as path:line | snippet", async () => {
    searchProjectMock.mockResolvedValue([
      { path: "src/a.ts", name: "a.ts", line: 3, content: "  const x = 1;  ", is_content_match: true },
      { path: "src/a.ts", name: "a.ts", line: 1, content: "a.ts", is_content_match: false },
    ]);
    const tool = searchCodebaseTool("/workspace");
    const outcome = await tool({ pattern: "const x" }, signal);
    expect(searchProjectMock).toHaveBeenCalledWith({
      rootDir: "/workspace",
      query: "const x",
      matchCase: false,
      wholeWord: false,
      isRegex: true,
    });
    expect(outcome).toEqual({ ok: true, output: "src/a.ts:3 | const x = 1;" });
  });

  it("returns 'No matches found.' when nothing matches", async () => {
    searchProjectMock.mockResolvedValue([]);
    const tool = searchCodebaseTool("/workspace");
    const outcome = await tool({ pattern: "nope" }, signal);
    expect(outcome).toEqual({ ok: true, output: "No matches found." });
  });

  it("rejects a missing pattern without calling the search service", async () => {
    const tool = searchCodebaseTool("/workspace");
    const outcome = await tool({}, signal);
    expect(outcome).toEqual({ ok: false, error: expect.stringContaining("pattern") });
    expect(searchProjectMock).not.toHaveBeenCalled();
  });

  it("caps results at 30 content matches", async () => {
    searchProjectMock.mockResolvedValue(
      Array.from({ length: 40 }, (_, i) => ({ path: `f${i}.ts`, name: `f${i}.ts`, line: 1, content: "x", is_content_match: true })),
    );
    const tool = searchCodebaseTool("/workspace");
    const outcome = await tool({ pattern: "x" }, signal);
    if (!outcome.ok) throw new Error("expected ok");
    expect(String(outcome.output).split("\n")).toHaveLength(30);
  });
});

describe("openDocumentTool", () => {
  function makeExcelBase64(): string {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Product", "Units", "Revenue"],
      ["Widget A", 100, 2500],
      ["Gadget B", 50, 1500],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Sales");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    return Buffer.from(buf).toString("base64");
  }

  it("fails gracefully when path parameter is missing or empty", async () => {
    const tool = openDocumentTool("/workspace");
    const outcome = await tool({ path: "" }, signal);
    expect(outcome).toEqual({ ok: false, error: expect.stringContaining("Missing required parameter 'path'") });
  });

  it("reads and parses an Excel spreadsheet into markdown table", async () => {
    const b64 = makeExcelBase64();
    invokeMock.mockResolvedValue(b64);

    const tool = openDocumentTool("/workspace");
    const outcome = await tool({ path: "data/sales.xlsx" }, signal);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.output).toContain("# Spreadsheet: /workspace/data/sales.xlsx");
    expect(outcome.output).toContain('## Sheet: "Sales"');
    expect(outcome.output).toContain("| Product | Units | Revenue |");
    expect(outcome.output).toContain("| Widget A | 100 | 2500 |");
    expect(outcome.output).toContain("| Gadget B | 50 | 1500 |");
  });

  it("resolves external paths and connected input files", async () => {
    const b64 = makeExcelBase64();
    invokeMock.mockResolvedValue(b64);

    const inputFiles = [{ path: "/external/reports/q1.xlsx", name: "q1.xlsx" }];
    const tool = openDocumentTool("/workspace", inputFiles);
    const outcome = await tool({ path: "q1.xlsx" }, signal);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.output).toContain("# Spreadsheet: /external/reports/q1.xlsx");
  });

  it("returns error outcome if underlying read rejects", async () => {
    invokeMock.mockRejectedValue(new Error("File not found: /workspace/missing.xlsx"));

    const tool = openDocumentTool("/workspace");
    const outcome = await tool({ path: "missing.xlsx" }, signal);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected error");
    expect(outcome.error).toContain("Could not read file");
    expect(outcome.error).toContain("File not found");
  });
});

describe("readTool binary document interception", () => {
  it("automatically routes binary documents like .xlsx to document parser instead of host.readFile", async () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([["ID", "Name"], [1, "Alice"]]);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    invokeMock.mockResolvedValue(Buffer.from(buf).toString("base64"));

    const hostReadFile = vi.fn();
    const tool = readTool("/workspace", fakeHost({ readFile: hostReadFile }));
    const outcome = await tool({ path: "users.xlsx" }, signal);

    expect(hostReadFile).not.toHaveBeenCalled();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.output).toContain("# Spreadsheet: /workspace/users.xlsx");
    expect(outcome.output).toContain("| ID | Name |");
    expect(outcome.output).toContain("| 1 | Alice |");
  });
});
