import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { searchService } from "../../../services/searchService";
import type { RunHost } from "../../contract";
import {
  EDIT_FILE_TOOL,
  LIST_FILES_TOOL,
  WRITE_FILE_TOOL,
  applyEdit,
  editTool,
  grantedToolName,
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

  describe("overwrite guard", () => {
    const EXISTING = "export const a = 1;\n";

    it("refuses to replace a file that has content, writes nothing, and says what to do instead", async () => {
      const writeFile = vi.fn();
      const modifiedFiles = new Set<string>();
      const tool = writeTool("/workspace", fakeHost({ readFile: vi.fn().mockResolvedValue(EXISTING), writeFile }), modifiedFiles);
      const outcome = await tool({ path: "src/a.ts", content: "export const a = 2;\n" }, signal);
      expect(outcome).toEqual({ ok: false, error: expect.stringContaining("'src/a.ts' already exists and has content") });
      expect(!outcome.ok && outcome.error).toContain("use edit_file");
      expect(!outcome.ok && outcome.error).toContain("overwrite set to true");
      expect(writeFile).not.toHaveBeenCalled();
      expect(modifiedFiles.size).toBe(0);
    });

    it("replaces it when overwrite is exactly true", async () => {
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const tool = writeTool("/workspace", fakeHost({ readFile: vi.fn().mockResolvedValue(EXISTING), writeFile }), new Set());
      expect(await tool({ path: "a.ts", content: "new", overwrite: true }, signal)).toMatchObject({ ok: true });
      expect(writeFile).toHaveBeenCalledWith("/workspace/a.ts", "new", signal);
      writeFile.mockClear();
      expect(await tool({ path: "a.ts", content: "new", overwrite: "true" }, signal)).toMatchObject({ ok: false });
      expect(writeFile).not.toHaveBeenCalled();
    });

    it("creates a file that does not exist yet", async () => {
      const readFile = vi.fn().mockRejectedValue(new Error("File not found on physical disk: /workspace/new.ts"));
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const tool = writeTool("/workspace", fakeHost({ readFile, writeFile }), new Set());
      expect(await tool({ path: "new.ts", content: "x" }, signal)).toMatchObject({ ok: true });
      expect(writeFile).toHaveBeenCalledWith("/workspace/new.ts", "x", signal);
    });

    it("writes over a blank file and over identical content without asking for overwrite", async () => {
      for (const existing of ["", "  \n\n"]) {
        const writeFile = vi.fn().mockResolvedValue(undefined);
        const tool = writeTool("/workspace", fakeHost({ readFile: vi.fn().mockResolvedValue(existing), writeFile }), new Set());
        expect(await tool({ path: "a.ts", content: "x" }, signal)).toMatchObject({ ok: true });
        expect(writeFile).toHaveBeenCalledTimes(1);
      }
      const same = vi.fn().mockResolvedValue(undefined);
      const tool = writeTool("/workspace", fakeHost({ readFile: vi.fn().mockResolvedValue(EXISTING), writeFile: same }), new Set());
      expect(await tool({ path: "a.ts", content: EXISTING }, signal)).toMatchObject({ ok: true });
    });

    it("lets the write decide when the file cannot be read", async () => {
      const writeFile = vi.fn().mockRejectedValue(new Error("permission denied"));
      const tool = writeTool("/workspace", fakeHost({ readFile: vi.fn().mockRejectedValue(new Error("permission denied")), writeFile }), new Set());
      expect(await tool({ path: "a.ts", content: "x" }, signal)).toEqual({ ok: false, error: "permission denied" });
    });

    it("rejects a call with no usable content instead of blanking the file", async () => {
      for (const bad of [undefined, null, 5, { text: "x" }]) {
        const writeFile = vi.fn();
        const tool = writeTool("/workspace", fakeHost({ readFile: vi.fn().mockResolvedValue(EXISTING), writeFile }), new Set());
        const outcome = await tool({ path: "a.ts", content: bad, overwrite: true }, signal);
        expect(outcome).toEqual({ ok: false, error: expect.stringContaining("content is required") });
        expect(writeFile).not.toHaveBeenCalled();
      }
    });

    it("still creates an empty file from an explicit empty string, and requires a path", async () => {
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const fresh = writeTool("/workspace", fakeHost({ readFile: vi.fn().mockRejectedValue(new Error("not found")), writeFile }), new Set());
      expect(await fresh({ path: "empty.txt", content: "" }, signal)).toMatchObject({ ok: true });
      expect(writeFile).toHaveBeenCalledWith("/workspace/empty.txt", "", signal);
      expect(await fresh({ content: "x" }, signal)).toEqual({ ok: false, error: "path is required." });
    });

    it("advertises overwrite as an optional boolean", () => {
      expect(Object.keys(WRITE_FILE_TOOL.input_schema.properties as object)).toEqual(["path", "content", "overwrite"]);
      expect(WRITE_FILE_TOOL.input_schema.required).toEqual(["path", "content"]);
      expect(WRITE_FILE_TOOL.description).toMatch(/refused unless overwrite is true/);
    });
  });
});

describe("edit_file tool spec", () => {
  it("requires path/old_string/new_string and keeps replace_all optional", () => {
    expect(EDIT_FILE_TOOL.name).toBe("edit_file");
    expect(EDIT_FILE_TOOL.input_schema.required).toEqual(["path", "old_string", "new_string"]);
    expect(Object.keys(EDIT_FILE_TOOL.input_schema.properties as object)).toEqual(["path", "old_string", "new_string", "replace_all"]);
  });

  it("steers existing-file changes to edit_file and leaves write_file for new files and full rewrites", () => {
    expect(EDIT_FILE_TOOL.description).toMatch(/Use this for every change to an existing file/);
    expect(WRITE_FILE_TOOL.description).toMatch(/Create a new file/);
    expect(WRITE_FILE_TOOL.description).toMatch(/use edit_file instead/);
    expect(WRITE_FILE_TOOL.description).not.toMatch(/or edit/i);
  });

  it("rides on the write_file grant rather than needing its own", () => {
    expect(grantedToolName("project_info")).toBe("read_file");
    expect(grantedToolName("run_check")).toBe("run_command");
    expect(grantedToolName("edit_file")).toBe("write_file");
    expect(grantedToolName("write_file")).toBe("write_file");
    expect(grantedToolName("read_file")).toBe("read_file");
  });
});

describe("applyEdit", () => {
  const FILE = "alpha\nbeta\ngamma\n";

  it("replaces the single exact match and reports where", () => {
    expect(applyEdit(FILE, { old_string: "beta", new_string: "BETA" })).toEqual({ ok: true, next: "alpha\nBETA\ngamma\n", replaced: 1, line: 2 });
  });

  it("matches across lines and reports the line it starts on", () => {
    expect(applyEdit(FILE, { old_string: "beta\ngamma", new_string: "x" })).toEqual({ ok: true, next: "alpha\nx\n", replaced: 1, line: 2 });
  });

  it("deletes with an empty new_string", () => {
    expect(applyEdit(FILE, { old_string: "beta\n", new_string: "" })).toMatchObject({ ok: true, next: "alpha\ngamma\n" });
  });

  it("inserts new_string literally, never as a replacement pattern", () => {
    const outcome = applyEdit("price = X;", { old_string: "X", new_string: "$& $1 $$ $`" });
    expect(outcome).toMatchObject({ ok: true, next: "price = $& $1 $$ $`;" });
  });

  it("refuses an ambiguous match, names the lines, and says nothing was changed", () => {
    const outcome = applyEdit("a\nx\na\nx\n", { old_string: "x", new_string: "y" });
    expect(outcome).toEqual({ ok: false, error: expect.stringContaining("matches 2 places (lines 2, 4)") });
    expect(!outcome.ok && outcome.error).toContain("nothing was changed");
    expect(!outcome.ok && outcome.error).toContain("replace_all");
  });

  it("caps the listed lines for a very ambiguous match", () => {
    const outcome = applyEdit("x\n".repeat(8), { old_string: "x", new_string: "y" });
    expect(!outcome.ok && outcome.error).toContain("lines 1, 2, 3, 4, 5 and 3 more");
  });

  it("replaces every occurrence only when replace_all is true", () => {
    expect(applyEdit("a x b x c", { old_string: "x", new_string: "y", replace_all: true })).toEqual({ ok: true, next: "a y b y c", replaced: 2, line: 1 });
    expect(applyEdit("a x b x c", { old_string: "x", new_string: "y", replace_all: "true" })).toMatchObject({ ok: false });
  });

  it("counts non-overlapping occurrences", () => {
    expect(applyEdit("aaa", { old_string: "aa", new_string: "b" })).toEqual({ ok: true, next: "ba", replaced: 1, line: 1 });
  });

  it("explains a missing match and that the file is untouched", () => {
    const outcome = applyEdit(FILE, { old_string: "delta", new_string: "x" });
    expect(!outcome.ok && outcome.error).toContain("not found");
    expect(!outcome.ok && outcome.error).toContain("nothing was changed");
    expect(!outcome.ok && outcome.error).toContain("whitespace");
  });

  it("rejects an empty or missing old_string instead of matching everywhere", () => {
    for (const old_string of ["", undefined, 5]) {
      expect(applyEdit(FILE, { old_string, new_string: "x" })).toEqual({ ok: false, error: expect.stringContaining("old_string is required") });
    }
    expect(applyEdit("", { old_string: "", new_string: "x" })).toMatchObject({ ok: false });
  });

  it("rejects a missing new_string and a no-op edit", () => {
    expect(applyEdit(FILE, { old_string: "beta" })).toEqual({ ok: false, error: expect.stringContaining("new_string is required") });
    expect(applyEdit(FILE, { old_string: "beta", new_string: "beta" })).toEqual({ ok: false, error: expect.stringContaining("identical") });
    expect(applyEdit(FILE, undefined)).toMatchObject({ ok: false });
  });

  it("matches LF text against a CRLF file and keeps its line endings", () => {
    const crlf = "alpha\r\nbeta\r\ngamma\r\n";
    expect(applyEdit(crlf, { old_string: "beta\ngamma", new_string: "b\ng2" })).toEqual({ ok: true, next: "alpha\r\nb\r\ng2\r\n", replaced: 1, line: 2 });
  });
});

describe("editTool", () => {
  const FILE = "export const a = 1;\nexport const b = 2;\n";

  it("reads, applies the edit, writes it back, and records the path on success", async () => {
    const readFile = vi.fn().mockResolvedValue(FILE);
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const modifiedFiles = new Set<string>();
    const tool = editTool("/workspace", fakeHost({ readFile, writeFile }), modifiedFiles);
    const outcome = await tool({ path: "src/a.ts", old_string: "b = 2", new_string: "b = 3" }, signal);
    expect(readFile).toHaveBeenCalledWith("/workspace/src/a.ts", signal);
    expect(writeFile).toHaveBeenCalledWith("/workspace/src/a.ts", "export const a = 1;\nexport const b = 3;\n", signal);
    expect(outcome).toEqual({ ok: true, output: "Edited /workspace/src/a.ts: replaced at line 2." });
    expect(modifiedFiles).toEqual(new Set(["/workspace/src/a.ts"]));
  });

  it("reports how many places a replace_all changed", async () => {
    const readFile = vi.fn().mockResolvedValue("x x x");
    const tool = editTool("/workspace", fakeHost({ readFile }), new Set());
    const outcome = await tool({ path: "a.ts", old_string: "x", new_string: "y", replace_all: true }, signal);
    expect(outcome).toEqual({ ok: true, output: "Edited /workspace/a.ts: replaced 3 occurrences, the first at line 1." });
  });

  it("resolves a connected input file by name like write_file does", async () => {
    const readFile = vi.fn().mockResolvedValue(FILE);
    const tool = editTool("/workspace", fakeHost({ readFile }), new Set(), [{ name: "a.ts", path: "/elsewhere/a.ts" }]);
    await tool({ path: "a.ts", old_string: "a = 1", new_string: "a = 9" }, signal);
    expect(readFile).toHaveBeenCalledWith("/elsewhere/a.ts", signal);
  });

  it("writes nothing and records nothing when the edit cannot apply", async () => {
    const writeFile = vi.fn();
    const modifiedFiles = new Set<string>();
    const tool = editTool("/workspace", fakeHost({ readFile: vi.fn().mockResolvedValue(FILE), writeFile }), modifiedFiles);
    const outcome = await tool({ path: "a.ts", old_string: "missing", new_string: "x" }, signal);
    expect(outcome).toEqual({ ok: false, error: expect.stringContaining("nothing was changed") });
    expect(writeFile).not.toHaveBeenCalled();
    expect(modifiedFiles.size).toBe(0);
  });

  it("points at write_file when the file does not exist", async () => {
    const readFile = vi.fn().mockRejectedValue(new Error("File not found on physical disk: /workspace/new.ts"));
    const writeFile = vi.fn();
    const tool = editTool("/workspace", fakeHost({ readFile, writeFile }), new Set());
    const outcome = await tool({ path: "new.ts", old_string: "a", new_string: "b" }, signal);
    expect(outcome).toEqual({ ok: false, error: "'new.ts' does not exist, so there is nothing to edit. Use write_file to create it." });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("says so when the path is a directory, and passes other read errors through", async () => {
    const dir = editTool("/workspace", fakeHost({ readFile: vi.fn().mockRejectedValue(new Error("Is a directory (os error 21)")) }), new Set());
    expect(await dir({ path: "src", old_string: "a", new_string: "b" }, signal)).toEqual({ ok: false, error: "'src' is a directory, not a file." });
    const denied = editTool("/workspace", fakeHost({ readFile: vi.fn().mockRejectedValue(new Error("permission denied")) }), new Set());
    expect(await denied({ path: "a.ts", old_string: "a", new_string: "b" }, signal)).toEqual({ ok: false, error: "permission denied" });
  });

  it("requires a path", async () => {
    const readFile = vi.fn();
    const tool = editTool("/workspace", fakeHost({ readFile }), new Set());
    expect(await tool({ old_string: "a", new_string: "b" }, signal)).toEqual({ ok: false, error: "path is required." });
    expect(readFile).not.toHaveBeenCalled();
  });

  it("does not record a failed write", async () => {
    const writeFile = vi.fn().mockRejectedValue(new Error("disk full"));
    const modifiedFiles = new Set<string>();
    const tool = editTool("/workspace", fakeHost({ readFile: vi.fn().mockResolvedValue(FILE), writeFile }), modifiedFiles);
    expect(await tool({ path: "a.ts", old_string: "a = 1", new_string: "a = 2" }, signal)).toEqual({ ok: false, error: "disk full" });
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

  describe("path, depth and glob", () => {
    const entry = (name: string, extra: Record<string, unknown> = {}) => ({ name, path: `/workspace/${name}`, is_dir: false, ...extra });
    const listing = (entries: unknown[], truncated = false) => ({ entries, truncated });

    it("still returns the overview when called with no usable arguments", async () => {
      invokeMock.mockResolvedValue([entry("a.ts")]);
      for (const args of [undefined, {}, { path: "  " }, { glob: "" }, { depth: null }]) {
        invokeMock.mockClear();
        await listFilesTool("/workspace")(args, signal);
        expect(invokeMock).toHaveBeenCalledWith("get_directory_structure", { rootDir: "/workspace" });
      }
    });

    it("lists one level of a workspace-relative directory through the bounded command", async () => {
      invokeMock.mockResolvedValue(listing([entry("components", { is_dir: true, entries: 12 }), entry("main.ts")]));
      const outcome = await listFilesTool("/workspace")({ path: "src/" }, signal);
      expect(invokeMock).toHaveBeenCalledWith("list_directory", { path: "/workspace/src", depth: 1 });
      expect(outcome).toEqual({ ok: true, output: ["src/ (1 level):", "components/ (12 entries)", "main.ts"].join("\n") });
    });

    it("lists the workspace root to a depth when only depth is given", async () => {
      invokeMock.mockResolvedValue(listing([entry("src", { is_dir: true, children: [entry("a.ts")] })]));
      const outcome = await listFilesTool("/workspace")({ depth: 2 }, signal);
      expect(invokeMock).toHaveBeenCalledWith("list_directory", { path: "/workspace", depth: 2 });
      expect(outcome).toEqual({ ok: true, output: [". (2 levels):", "src/", "  a.ts"].join("\n") });
    });

    it("clamps an absurd depth instead of trusting it", async () => {
      invokeMock.mockResolvedValue(listing([]));
      await listFilesTool("/workspace")({ path: "src", depth: 1000 }, signal);
      expect(invokeMock).toHaveBeenCalledWith("list_directory", { path: "/workspace/src", depth: 8 });
    });

    it("finds files by glob across the tree, defaulting to full depth", async () => {
      invokeMock.mockResolvedValue(listing([entry("apps", { is_dir: true, children: [entry("package.json", { is_dir: false })] }), entry("package.json")]));
      const outcome = await listFilesTool("/workspace")({ glob: "package.json" }, signal);
      expect(invokeMock).toHaveBeenCalledWith("list_directory", { path: "/workspace", depth: 8 });
      expect(outcome).toEqual({ ok: true, output: ["2 files match package.json in the workspace:", "apps/package.json", "package.json"].join("\n") });
    });

    it("passes an absolute path through, like read_file does", async () => {
      invokeMock.mockResolvedValue(listing([]));
      await listFilesTool("/workspace")({ path: "/elsewhere/lib" }, signal);
      expect(invokeMock).toHaveBeenCalledWith("list_directory", { path: "/elsewhere/lib", depth: 1 });
    });

    it("explains a missing directory and a file, since Tauri rejects with plain strings", async () => {
      invokeMock.mockRejectedValue("Directory does not exist");
      expect(await listFilesTool("/workspace")({ path: "nope" }, signal)).toEqual({
        ok: false,
        error: "'nope' does not exist. Call list_files with no arguments for an overview of the workspace.",
      });
      invokeMock.mockRejectedValue("Not a directory");
      expect(await listFilesTool("/workspace")({ path: "a.ts" }, signal)).toEqual({
        ok: false,
        error: "'a.ts' is a file, not a directory. Use read_file to read it.",
      });
      invokeMock.mockRejectedValue("permission denied");
      expect(await listFilesTool("/workspace")({ path: "locked" }, signal)).toEqual({ ok: false, error: "permission denied" });
    });
  });
});

describe("list_files tool spec", () => {
  it("advertises optional path, depth and glob", () => {
    expect(Object.keys(LIST_FILES_TOOL.input_schema.properties as object)).toEqual(["path", "depth", "glob"]);
    expect(LIST_FILES_TOOL.input_schema.required).toEqual([]);
    expect(LIST_FILES_TOOL.description).toMatch(/With no arguments it returns an overview/);
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
