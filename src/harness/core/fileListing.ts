// ============================================================
// fileListing.ts -- pure helpers behind `list_files`' path/depth/glob modes:
// glob matching and the text a model reads. The directory walk itself is the
// `list_directory` Tauri command (src-tauri/src/dir_listing.rs); nothing here
// touches the disk, so all of it is unit-testable.
// ============================================================

/** One entry of the `list_directory` command's result. */
export interface ListingEntry {
  name: string;
  path: string;
  is_dir: boolean;
  /** A directory's contents, when they were listed. */
  children?: ListingEntry[] | null;
  /** How many entries a directory holds, when its contents were not listed. */
  entries?: number | null;
}

export interface ListingResult {
  entries: ListingEntry[];
  /** The walk stopped at its entry limit and omits the rest. */
  truncated: boolean;
}

export const MAX_LISTING_LINES = 400;
export const MAX_GLOB_MATCHES = 200;
export const MAX_DEPTH = 8;

/** A model-given path as an absolute one: already-absolute and `~` paths pass
 * through, anything else is resolved against the workspace root. */
export function resolveWorkspacePath(workspaceRoot: string, inputPath: string): string {
  if (/^([a-zA-Z]:[\\/]|\/)/.test(inputPath)) return inputPath;
  if (inputPath.startsWith("~/") || inputPath === "~") return inputPath;
  const sep = workspaceRoot.includes("\\") && !workspaceRoot.includes("/") ? "\\" : "/";
  return workspaceRoot.endsWith(sep) ? `${workspaceRoot}${inputPath}` : `${workspaceRoot}${sep}${inputPath}`;
}

/** The directory a call asks about, as the model should see it: relative to
 * the workspace unless it was given as an absolute path. "" means the root. */
export function normalizeBase(path: string): string {
  const trimmed = path.trim().replace(/\\/g, "/");
  if (trimmed === "" || trimmed === "." || trimmed === "./") return "";
  const withoutDot = trimmed.replace(/^(\.\/)+/, "");
  return withoutDot.length > 1 ? withoutDot.replace(/\/+$/, "") : withoutDot;
}

/** The depth to list: the model's number if it is usable, else the default. */
export function resolveDepth(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(number)) return fallback;
  return Math.min(MAX_DEPTH, Math.max(1, Math.floor(number)));
}

const REGEX_SPECIAL = /[.+^$()|[\]\\]/g;

/**
 * Turns a glob into a RegExp over `/`-separated relative paths: `*` stays
 * within a folder, `**` crosses folders (and `**` followed by `/` also matches
 * no folder at all), `?` is one character, `{a,b}` is alternatives. A pattern
 * with no `/` matches a name at any depth, like `find -name`.
 */
export function globToRegExp(glob: string): RegExp {
  const pattern = glob.includes("/") ? glob.replace(/^\.\//, "") : `**/${glob}`;
  let source = "";
  let braces = 0;
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        i += 1;
        if (pattern[i + 1] === "/") {
          i += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else if (char === "{") {
      braces += 1;
      source += "(?:";
    } else if (char === "}" && braces > 0) {
      braces -= 1;
      source += ")";
    } else if (char === "," && braces > 0) {
      source += "|";
    } else {
      source += char.replace(REGEX_SPECIAL, "\\$&").replace(/[{}]/g, "\\$&");
    }
  }
  source += ")".repeat(braces);
  return new RegExp(`^${source}$`);
}

function describeDirectory(entry: ListingEntry): string {
  if (entry.children) return entry.children.length === 0 ? "/ (empty)" : "/";
  if (typeof entry.entries === "number") return `/ (${entry.entries} ${entry.entries === 1 ? "entry" : "entries"})`;
  return "/";
}

/** An indented listing of `result`, headed by the directory it is for. */
export function renderListing(base: string, depth: number, result: ListingResult): string {
  const lines: string[] = [];
  const walk = (entries: ListingEntry[], level: number) => {
    for (const entry of entries) {
      lines.push(`${"  ".repeat(level)}${entry.name}${entry.is_dir ? describeDirectory(entry) : ""}`);
      if (entry.children?.length) walk(entry.children, level + 1);
    }
  };
  walk(result.entries, 0);

  const heading = `${base === "" ? "." : `${base}/`} (${depth === 1 ? "1 level" : `${depth} levels`})`;
  if (lines.length === 0) return `${heading}: empty.`;

  const shown = lines.slice(0, MAX_LISTING_LINES);
  const notes: string[] = [];
  if (lines.length > shown.length) {
    notes.push(`... and ${lines.length - shown.length} more lines. Use path to look inside one folder, or glob to find files by name.`);
  }
  if (result.truncated) {
    notes.push("The folder is too large to list completely; use path or glob to narrow it.");
  }
  return [`${heading}:`, ...shown, ...notes].join("\n");
}

/** Files under `result` whose path, relative to the listed directory, matches
 * `glob`, as paths a model can hand to `read_file`. */
export function renderGlobMatches(base: string, glob: string, result: ListingResult): string {
  const matcher = globToRegExp(glob);
  const matches: string[] = [];
  const walk = (entries: ListingEntry[], prefix: string) => {
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.is_dir) {
        if (entry.children) walk(entry.children, relative);
      } else if (matcher.test(relative)) {
        matches.push(base ? `${base}/${relative}` : relative);
      }
    }
  };
  walk(result.entries, "");

  const where = base === "" ? "the workspace" : `${base}/`;
  if (matches.length === 0) {
    const narrowed = result.truncated ? " The folder was too large to search completely; use path to narrow it." : "";
    return `No files in ${where} match ${glob}.${narrowed}`;
  }
  const shown = matches.slice(0, MAX_GLOB_MATCHES);
  const notes: string[] = [];
  if (matches.length > shown.length) notes.push(`... and ${matches.length - shown.length} more matches. Make the glob or path more specific.`);
  if (result.truncated) notes.push("The folder was too large to search completely, so some matches may be missing; use path to narrow it.");
  return [`${matches.length} ${matches.length === 1 ? "file matches" : "files match"} ${glob} in ${where}:`, ...shown, ...notes].join("\n");
}
