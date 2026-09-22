// ============================================================
// definitions/exploreTools.ts — IDE-implemented host tools shared by any
// capability needing read/write/list/search over the workspace
// (global_explore's read-only trio; execute_node adds write): "read"/
// "read_file" reuse the same VFS-aware RunHost.readFile every other
// capability's file access already goes through, and "write_file" the
// matching RunHost.writeFile; "list_files"/"search_codebase" hit real disk
// directly via existing Tauri commands (get_directory_structure/
// search_project), mirroring the sidecar's own split
// (agent-sidecar/src/services/tools.ts: read_file/write_file go through
// the host, list_files/search_codebase are disk-only) -- see
// host_workspace.rs's own doc comment for the Rust side of that same
// split.
//
// Tool names/descriptions/input schemas match
// agent-sidecar/src/capabilities/{globalExplore,executeNode}.ts and
// agent-sidecar/src/services/tools.ts exactly (global_explore's own "read"
// tool and execute_node's own "read_file" tool are two different names for
// the same underlying behavior, kept distinct here rather than merged,
// since each capability's own system prompt references its sidecar
// counterpart's exact tool name), so the system prompt that references
// them describes the same tools the model has seen behave this way
// before. The summary-generation and search-formatting logic underneath
// is a from-scratch implementation against the IDE's own Tauri commands,
// not a byte-for-byte port of the sidecar's Node-`fs`-based one (which
// isn't reachable from this process at all) -- same tool contract and
// output shape, different implementation.
// ============================================================

import { invoke } from "@tauri-apps/api/core";

import { searchService } from "../../../services/searchService";
import { isBinaryDocumentFile, parseDocument } from "../../../services/documentParserService";
import type { RunHost } from "../../contract";
import type { HostToolHandler } from "../CoreHarness";
import type { HostToolSpec } from "../SessionRecipe";

/** Matches agent-sidecar/src/services/tools.ts's IGNORED_DIRS exactly.
 * get_directory_structure already filters a smaller subset of these
 * (node_modules/.git/target/dist/.vscode/.gemini) on the Rust side; this
 * set is re-applied here so the two extra names sidecar's own explorer
 * ignores (.next, __pycache__, .env/env/.venv/venv) are dropped the same
 * way for a core-routed run. */
const IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  "target",
  ".vscode",
  ".gemini",
  ".next",
  "__pycache__",
  ".env",
  "env",
  ".venv",
  "venv",
]);

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileEntry[] | null;
}
export const READ_TOOL: HostToolSpec = {
  name: "read",
  description: "Read a file from the workspace.",
  input_schema: {
    type: "object",
    properties: { path: { type: "string", description: "The file path to read" } },
    required: ["path"],
  },
};

export const LIST_FILES_TOOL: HostToolSpec = {
  name: "list_files",
  description: "Get a summary of the workspace structure including directories, file types, and a sample of files.",
  input_schema: { type: "object", properties: {}, required: [] },
};

export const SEARCH_CODEBASE_TOOL: HostToolSpec = {
  name: "search_codebase",
  description:
    "Find files containing a search term or regex pattern. Returns matching file paths and line snippets (limited to 30 results).",
  input_schema: {
    type: "object",
    properties: { pattern: { type: "string", description: "The search pattern or regex to match" } },
    required: ["pattern"],
  },
};

/** execute_node's own name for the same read behavior as READ_TOOL above --
 * see this file's header comment on why the two names stay distinct. */
export const READ_FILE_TOOL: HostToolSpec = {
  name: "read_file",
  description: "Read a file's content from the virtual workspace.",
  input_schema: {
    type: "object",
    properties: { path: { type: "string", description: "The file path to read" } },
    required: ["path"],
  },
};

export const WRITE_FILE_TOOL: HostToolSpec = {
  name: "write_file",
  description: "Write or edit a file's content in the virtual workspace.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "The file path to write/edit" },
      content: { type: "string", description: "The full content of the file" },
    },
    required: ["path", "content"],
  },
};

export const OPEN_DOCUMENT_TOOL: HostToolSpec = {
  name: "open_document",
  description:
    "Open, read, and extract readable content from documents including Excel spreadsheets (.xlsx, .xls, .ods, .xlsb), PDF documents (.pdf), Word documents (.docx), CSV/TSV, and other formatted text files. Returns structured Markdown tables for spreadsheets, extracted page text for PDFs, and formatted text for documents.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The file path to the document to read (can be inside workspace or an external path).",
      },
      sheet: {
        type: "string",
        description: "Optional sheet name or 1-based index (for Excel/spreadsheet files). If omitted, displays sheet overview and first sheet data.",
      },
      page: {
        type: "number",
        description: "Optional 1-based page number (for PDF files). If omitted, extracts up to maxPages.",
      },
      maxRows: {
        type: "number",
        description: "Optional maximum rows to return for spreadsheets (default: 100).",
      },
    },
    required: ["path"],
  },
};

export const EXPLORE_TOOLS: HostToolSpec[] = [READ_TOOL, LIST_FILES_TOOL, SEARCH_CODEBASE_TOOL, OPEN_DOCUMENT_TOOL];

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null) : [];
}

function resolveWorkspacePath(workspaceRoot: string, inputPath: string): string {
  if (/^([a-zA-Z]:[\\/]|\/)/.test(inputPath)) return inputPath;
  if (inputPath.startsWith("~/") || inputPath === "~") return inputPath;
  const sep = workspaceRoot.includes("\\") && !workspaceRoot.includes("/") ? "\\" : "/";
  return workspaceRoot.endsWith(sep) ? `${workspaceRoot}${inputPath}` : `${workspaceRoot}${sep}${inputPath}`;
}

function isNotFoundError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("not found") || lower.includes("no such file") || lower.includes("exist");
}

function isDirectoryError(message: string): boolean {
  return message.toLowerCase().includes("directory");
}

function resolveWithInputFiles(rawPath: string, inputFiles?: unknown): string {
  if (!inputFiles) return rawPath;
  const files = asRecordArray(inputFiles);
  const matched = files.find((f) => {
    const p = String(f.path ?? "");
    const n = String(f.name ?? "");
    return (
      p === rawPath ||
      n === rawPath ||
      p.endsWith("/" + rawPath) ||
      p.endsWith("\\" + rawPath)
    );
  });
  return matched && matched.path ? String(matched.path) : rawPath;
}

/** "read": resolves a model-given path against workspaceRoot (mirroring
 * the sidecar's own `path.isAbsolute(filePath) ? filePath :
 * path.join(workspaceRoot, filePath)`), then reuses RunHost.readFile --
 * the same VFS-aware read every other capability's file access goes
 * through. A missing file or a directory read both come back as a
 * friendly `ok: true` message (matching the sidecar's own read tool)
 * rather than an error, since either is a normal, expected outcome of
 * exploration, not an infrastructure failure. */
export function readTool(workspaceRoot: string, host: RunHost, inputFiles?: unknown): HostToolHandler {
  return async (args, signal) => {
    const filePath = String((args as { path?: unknown } | undefined)?.path ?? "");
    const targetPath = resolveWithInputFiles(filePath, inputFiles);
    const absolute = resolveWorkspacePath(workspaceRoot, targetPath);

    if (isBinaryDocumentFile(absolute)) {
      const docResult = await parseDocument({ path: absolute });
      if (docResult.ok) {
        return { ok: true, output: docResult.content || "[Empty document]" };
      }
      return { ok: false, error: docResult.error || "Failed to read binary document." };
    }

    try {
      const content = await host.readFile(absolute, signal);
      return { ok: true, output: content };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (isNotFoundError(message)) {
        return { ok: true, output: "[File does not exist yet. You can create it by calling write_file with content.]" };
      }
      if (isDirectoryError(message)) {
        return {
          ok: true,
          output: `Error: '${filePath}' is a directory, not a file. To list directory contents, use list_files.`,
        };
      }
      return { ok: false, error: message };
    }
  };
}

/** "write_file": resolves a model-given path against workspaceRoot the
 * same way `readTool` does, then writes it via RunHost.writeFile. Records
 * the resolved absolute path into `modifiedFiles` -- the caller's own
 * per-run tracking set (see CoreHarness's `RunContext` doc comment) --
 * but only on a successful write, unlike the sidecar's own write_file
 * tool, which adds to its `modifiedFiles` set unconditionally before the
 * write even happens (agent-sidecar/src/capabilities/executeNode.ts:
 * `modifiedFiles.add(resolvedPath)` runs before the RPC call, so a write
 * that later fails is still reported as modified). That looks like a
 * latent sidecar bug rather than intentional behavior -- a failed write
 * changed nothing, so reporting it as modified would show a bogus diff
 * for an unchanged file -- and is fixed here rather than replicated. */
export function writeTool(workspaceRoot: string, host: RunHost, modifiedFiles: Set<string>, inputFiles?: unknown): HostToolHandler {
  return async (args, signal) => {
    const input = args as { path?: unknown; content?: unknown } | undefined;
    const filePath = String(input?.path ?? "");
    const content = String(input?.content ?? "");
    const targetPath = resolveWithInputFiles(filePath, inputFiles);
    const absolute = resolveWorkspacePath(workspaceRoot, targetPath);
    try {
      await host.writeFile(absolute, content, signal);
      modifiedFiles.add(absolute);
      return { ok: true, output: `File successfully written to: ${absolute}` };
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
}

const MAX_SUMMARY_DEPTH = 3;
const MAX_SAMPLE_FILES = 100;

function summarizeWorkspace(root: FileEntry[]): string {
  const topLevelFileCounts = new Map<string, number>();
  const extCounts = new Map<string, number>();
  const sampleFiles: string[] = [];
  let totalFiles = 0;
  let totalDirs = 0;

  const walk = (entries: FileEntry[], depth: number, topLevelDir: string | null, relPrefix: string) => {
    if (depth > MAX_SUMMARY_DEPTH) return;
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.is_dir) {
        totalDirs += 1;
        walk(entry.children ?? [], depth + 1, topLevelDir ?? entry.name, rel);
      } else {
        totalFiles += 1;
        if (topLevelDir) topLevelFileCounts.set(topLevelDir, (topLevelFileCounts.get(topLevelDir) ?? 0) + 1);
        const dot = entry.name.lastIndexOf(".");
        const ext = dot > 0 ? entry.name.slice(dot).toLowerCase() : "no_extension";
        extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
        if (sampleFiles.length < MAX_SAMPLE_FILES) sampleFiles.push(rel);
      }
    }
  };
  walk(root, 0, null, "");

  const topDirs = [...topLevelFileCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([dir, count]) => `${dir}/ (${count} files)`)
    .join("\n");
  const topExts = [...extCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([ext, count]) => `${ext}: ${count} files`)
    .join("\n");
  const sample = sampleFiles.length > 0 ? `\n\nSample files (first ${sampleFiles.length}):\n${sampleFiles.join("\n")}` : "";

  return `Workspace Summary:
- Total: ${totalFiles} files, ${totalDirs} directories

Top-level directories:
${topDirs || "(none found)"}

File types:
${topExts || "(none detected)"}
${sample}`;
}

/** "list_files": the same get_directory_structure Tauri command the file
 * tree itself is built from, summarized to top-level directory/extension
 * counts and a capped file sample -- a workspace-structure overview, not
 * a full recursive listing (matching the sidecar tool's own name-vs-
 * behavior mismatch: despite its name, it returns a summary). */
export function listFilesTool(workspaceRoot: string): HostToolHandler {
  return async () => {
    try {
      const tree = await invoke<FileEntry[]>("get_directory_structure", { rootDir: workspaceRoot });
      return { ok: true, output: summarizeWorkspace(tree) };
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
}

/** "search_codebase": the same search_project Tauri command the editor's
 * own search panel uses (ripgrep-backed, .gitignore-aware), restricted to
 * content matches and formatted as `path:line | snippet`, matching the
 * sidecar tool's own output shape. */
export function searchCodebaseTool(workspaceRoot: string): HostToolHandler {
  return async (args) => {
    const pattern = String((args as { pattern?: unknown } | undefined)?.pattern ?? "");
    if (!pattern) return { ok: false, error: "search_codebase requires a 'pattern' argument." };
    try {
      const matches = await searchService.searchProject({
        rootDir: workspaceRoot,
        query: pattern,
        matchCase: false,
        wholeWord: false,
        isRegex: true,
      });
      const contentMatches = matches.filter((match) => match.is_content_match).slice(0, 30);
      if (contentMatches.length === 0) return { ok: true, output: "No matches found." };
      const output = contentMatches.map((match) => `${match.path}:${match.line} | ${match.content.trim().slice(0, 200)}`).join("\n");
      return { ok: true, output };
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
}

/** "open_document": extracts structured content from spreadsheets (.xlsx/.xls/.ods),
 * PDFs (.pdf), Word documents (.docx), CSV/TSV, and formatted text documents.
 * Supports workspace-relative paths, inputFiles references, and external/tilde paths. */
export function openDocumentTool(workspaceRoot: string, inputFiles?: unknown): HostToolHandler {
  return async (args) => {
    const rawPath = String((args as { path?: unknown } | undefined)?.path ?? "");
    if (!rawPath.trim()) {
      return { ok: false, error: "Missing required parameter 'path'." };
    }
    const targetPath = resolveWithInputFiles(rawPath, inputFiles);
    const absolute = resolveWorkspacePath(workspaceRoot, targetPath);

    const sheet = (args as { sheet?: unknown })?.sheet;
    const page = (args as { page?: unknown })?.page;
    const maxRows = (args as { maxRows?: unknown })?.maxRows;

    const result = await parseDocument({
      path: absolute,
      sheet: typeof sheet === "string" || typeof sheet === "number" ? sheet : undefined,
      page: typeof page === "number" ? page : undefined,
      maxRows: typeof maxRows === "number" ? maxRows : undefined,
    });

    if (result.ok) {
      return { ok: true, output: result.content || "[Empty document]" };
    }
    return { ok: false, error: result.error || "Failed to open document." };
  };
}
