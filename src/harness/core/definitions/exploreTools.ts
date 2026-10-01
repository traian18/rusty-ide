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
import {
  MAX_DEPTH as MAX_LISTING_DEPTH,
  normalizeBase,
  renderGlobMatches,
  renderListing,
  resolveDepth,
  resolveWorkspacePath,
  type ListingResult,
} from "../fileListing";

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
  description:
    "Explore the workspace's files. With no arguments it returns an overview: top-level directories, file types and a sample of files. With path it lists that directory (one level by default; raise depth to see more levels). With glob it finds files by name under path, for example package.json, **/*.test.ts or src/**/*.{ts,tsx}. Paths are relative to the workspace root, and dependency and build-output folders such as node_modules and target are left out.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory to list, relative to the workspace root. Omit to start at the root." },
      depth: { type: "number", description: "How many levels to show below path, 1 to 8. Defaults to 1, or to 8 when glob is set." },
      glob: {
        type: "string",
        description: "Only list files matching this pattern, relative to path: * stays within a folder, ** crosses folders, ? is one character, {a,b} are alternatives. A pattern without a / matches that name at any depth.",
      },
    },
    required: [],
  },
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
  description:
    "Create a new file, or replace an existing file's entire content. Replacing a file that already has content is refused unless overwrite is true. To change part of an existing file use edit_file instead: rewriting a whole file to change a few lines risks dropping the lines you did not retype.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "The file path to create or overwrite" },
      content: { type: "string", description: "The complete content of the file" },
      overwrite: { type: "boolean", description: "Set to true only to replace the whole content of a file that already has content. Defaults to false." },
    },
    required: ["path", "content"],
  },
};

export const EDIT_FILE_TOOL: HostToolSpec = {
  name: "edit_file",
  description:
    "Change part of an existing file by replacing one exact piece of its text. Use this for every change to an existing file; use write_file only to create a new file or when a complete rewrite is intended. Read the file first. old_string must match the file exactly, including whitespace and indentation, and must appear exactly once: include enough surrounding lines to make it unique, or set replace_all to change every occurrence. If the edit fails the file is left untouched.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "The path of the existing file to edit" },
      old_string: { type: "string", description: "The exact text to replace, copied from the file. Must not be empty." },
      new_string: { type: "string", description: "The text to put in its place. Use an empty string to delete old_string. Must differ from old_string." },
      replace_all: { type: "boolean", description: "Replace every occurrence of old_string instead of requiring exactly one. Defaults to false." },
    },
    required: ["path", "old_string", "new_string"],
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
/** The absolute path a `write_file` call with these arguments writes to. */
export function resolveWriteTarget(workspaceRoot: string, args: unknown, inputFiles?: unknown): string {
  const filePath = String((args as { path?: unknown } | undefined)?.path ?? "");
  return resolveWorkspacePath(workspaceRoot, resolveWithInputFiles(filePath, inputFiles));
}

/**
 * Why `write_file` must not replace `previous` with this call's `content`;
 * `undefined` when it may go ahead: a new or blank file, an identical
 * rewrite, or a call that sets `overwrite: true`. Pure, so the risk review can
 * leave out a write the tool is about to refuse instead of reviewing it first.
 */
export function overwriteRefusal(previous: string | undefined, args: unknown): string | undefined {
  const input = args as { path?: unknown; content?: unknown; overwrite?: unknown } | undefined;
  if (previous === undefined || previous.trim() === "") return undefined;
  if (input?.overwrite === true || input?.content === previous) return undefined;
  return `'${String(input?.path ?? "")}' already exists and has content, and write_file would replace all of it, so nothing was written. To change part of it, use edit_file. If a complete rewrite is really intended, call write_file again with overwrite set to true.`;
}

export function writeTool(workspaceRoot: string, host: RunHost, modifiedFiles: Set<string>, inputFiles?: unknown): HostToolHandler {
  return async (args, signal) => {
    const input = args as { path?: unknown; content?: unknown } | undefined;
    if (!String(input?.path ?? "").trim()) return { ok: false, error: "path is required." };
    // A call that lost its content must not silently blank the file.
    if (typeof input?.content !== "string") {
      return {
        ok: false,
        error: "content is required and must be a string (use an empty string for an empty file), so nothing was written. To change part of an existing file, use edit_file.",
      };
    }
    const content = input.content;
    const absolute = resolveWriteTarget(workspaceRoot, args, inputFiles);

    let previous: string | undefined;
    try {
      previous = await host.readFile(absolute, signal);
    } catch {
      // Missing (a new file) or unreadable: the write below decides what happens.
      previous = undefined;
    }
    const refusal = overwriteRefusal(previous, args);
    if (refusal) return { ok: false, error: refusal };

    try {
      await host.writeFile(absolute, content, signal);
      modifiedFiles.add(absolute);
      return { ok: true, output: `File successfully written to: ${absolute}` };
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
}

/** Some tools have no grant of their own: `edit_file` rides on `write_file`
 * (a skill that may write may edit; one that may not gets neither),
 * `project_info`, which only reads manifests, rides on `read_file`, and
 * `run_check` and `install_dependencies`, which run the project's own
 * commands, ride on `run_command`.
 * Call sites map a tool name through this before checking it against
 * `enabledTools`. rusty-core mirrors the mapping in `tool_alias.rs` /
 * `execution_policy.rs`. */
export function grantedToolName(name: string): string {
  if (name === "edit_file") return "write_file";
  if (name === "project_info") return "read_file";
  if (name === "run_check" || name === "install_dependencies") return "run_command";
  return name;
}

export type EditOutcome =
  | { ok: true; next: string; replaced: number; line: number }
  | { ok: false; error: string };

const MAX_LISTED_MATCH_LINES = 5;

/** The 1-based line of every non-overlapping occurrence of `find` in `text`. */
function matchLines(text: string, find: string): number[] {
  const lines: number[] = [];
  let line = 1;
  let scanned = 0;
  for (let at = text.indexOf(find); at >= 0; at = text.indexOf(find, at + find.length)) {
    for (let nl = text.indexOf("\n", scanned); nl >= 0 && nl < at; nl = text.indexOf("\n", scanned)) {
      line += 1;
      scanned = nl + 1;
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Applies an `edit_file` call to `previous`. Pure: it never touches the disk,
 * so the write handler and the risk review judge exactly the same result.
 * Strict on purpose -- no fuzzy matching -- so a call can never silently
 * change the wrong place; every failure says what to do next and that the
 * file was left alone.
 */
export function applyEdit(previous: string, args: unknown): EditOutcome {
  const input = (args ?? {}) as { old_string?: unknown; new_string?: unknown; replace_all?: unknown };
  const { old_string: oldString, new_string: newString } = input;
  if (typeof oldString !== "string" || oldString === "") {
    return { ok: false, error: "old_string is required and must not be empty. To create a file, or replace all of its content, use write_file." };
  }
  if (typeof newString !== "string") {
    return { ok: false, error: "new_string is required. Use an empty string to delete old_string." };
  }
  if (oldString === newString) {
    return { ok: false, error: "old_string and new_string are identical, so nothing would change." };
  }

  let find = oldString;
  let replacement = newString;
  let lines = matchLines(previous, find);
  // Model-written text uses \n; a CRLF file would otherwise never match it.
  if (lines.length === 0 && previous.includes("\r\n") && !oldString.includes("\r")) {
    find = oldString.replace(/\n/g, "\r\n");
    replacement = newString.replace(/\n/g, "\r\n");
    lines = matchLines(previous, find);
  }

  if (lines.length === 0) {
    return {
      ok: false,
      error: "old_string was not found in the file, so nothing was changed. Read the file again and copy the text exactly, including whitespace and indentation.",
    };
  }
  if (lines.length > 1 && input.replace_all !== true) {
    const shown = lines.slice(0, MAX_LISTED_MATCH_LINES).join(", ");
    const more = lines.length > MAX_LISTED_MATCH_LINES ? ` and ${lines.length - MAX_LISTED_MATCH_LINES} more` : "";
    return {
      ok: false,
      error: `old_string matches ${lines.length} places (lines ${shown}${more}), so nothing was changed. Include more surrounding lines to make it unique, or set replace_all to true to change every occurrence.`,
    };
  }
  return { ok: true, next: previous.split(find).join(replacement), replaced: lines.length, line: lines[0] };
}

/** "edit_file": a strict find-and-replace on an existing file, resolved and
 * tracked exactly like `writeTool` (same VFS-aware RunHost read/write, and the
 * path is recorded as modified only after a successful write). */
export function editTool(workspaceRoot: string, host: RunHost, modifiedFiles: Set<string>, inputFiles?: unknown): HostToolHandler {
  return async (args, signal) => {
    const filePath = String((args as { path?: unknown } | undefined)?.path ?? "");
    if (!filePath.trim()) return { ok: false, error: "path is required." };
    const absolute = resolveWriteTarget(workspaceRoot, args, inputFiles);

    let previous: string;
    try {
      previous = await host.readFile(absolute, signal);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (isNotFoundError(message)) {
        return { ok: false, error: `'${filePath}' does not exist, so there is nothing to edit. Use write_file to create it.` };
      }
      if (isDirectoryError(message)) {
        return { ok: false, error: `'${filePath}' is a directory, not a file.` };
      }
      return { ok: false, error: message };
    }

    const outcome = applyEdit(previous, args);
    if (!outcome.ok) return { ok: false, error: outcome.error };
    try {
      await host.writeFile(absolute, outcome.next, signal);
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    modifiedFiles.add(absolute);
    const where = outcome.replaced === 1 ? `at line ${outcome.line}` : `${outcome.replaced} occurrences, the first at line ${outcome.line}`;
    return { ok: true, output: `Edited ${absolute}: replaced ${where}.` };
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

/** "list_files": three modes, picked by what the model passes.
 *  - Nothing: the same get_directory_structure Tauri command the file tree
 *    is built from, summarized to top-level directory/extension counts and a
 *    capped file sample -- the workspace-structure overview this tool has
 *    always returned (the sidecar tool's own name-vs-behavior mismatch).
 *  - `path` / `depth`: that directory, to that depth.
 *  - `glob`: files under `path` whose name matches.
 * The last two use the bounded `list_directory` command (src-tauri/src/
 * dir_listing.rs), so a huge folder costs one capped walk, not a full one. */
export function listFilesTool(workspaceRoot: string): HostToolHandler {
  return async (args) => {
    const input = (args ?? {}) as { path?: unknown; depth?: unknown; glob?: unknown };
    const path = typeof input.path === "string" ? input.path : "";
    const glob = typeof input.glob === "string" ? input.glob.trim() : "";
    const asked = path.trim() !== "" || glob !== "" || (input.depth !== undefined && input.depth !== null);

    if (!asked) {
      try {
        const tree = await invoke<FileEntry[]>("get_directory_structure", { rootDir: workspaceRoot });
        return { ok: true, output: summarizeWorkspace(tree) };
      } catch (error: unknown) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    const base = normalizeBase(path);
    const depth = resolveDepth(input.depth, glob ? MAX_LISTING_DEPTH : 1);
    try {
      const result = await invoke<ListingResult>("list_directory", {
        path: base === "" ? workspaceRoot : resolveWorkspacePath(workspaceRoot, base),
        depth,
      });
      return { ok: true, output: glob ? renderGlobMatches(base, glob, result) : renderListing(base, depth, result) };
    } catch (error: unknown) {
      // Tauri rejects with the command's error string, not an Error.
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("does not exist")) {
        return { ok: false, error: `'${base || "."}' does not exist. Call list_files with no arguments for an overview of the workspace.` };
      }
      if (message.includes("Not a directory")) {
        return { ok: false, error: `'${base}' is a file, not a directory. Use read_file to read it.` };
      }
      return { ok: false, error: message };
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
