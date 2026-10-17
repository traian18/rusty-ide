/**
 * The explicit contract for "open this source location in the editor". Every place in the
 * architecture UI that links to code builds its request here, so stale locations are handled once.
 */
import type { OpenTabRequest } from "../tabs/types";

export interface NavigationTarget {
  /** Root-relative path, as the repository contracts report it. */
  file: string;
  /** 1-based line, when known and still trustworthy. */
  line?: number | null;
  /** Carried for a future editor API; the file tab does not use it yet. */
  column?: number | null;
  /** The file changed since the snapshot, so a line from it cannot be trusted. */
  stale?: boolean;
}

export interface NavigationRequest {
  tab: Extract<OpenTabRequest, { type: "file" }>;
  /** Shown to the person when the location could not be honoured exactly. */
  notice: string | null;
}

/** Joins the workspace root and a root-relative path with forward slashes. */
export function absolutePath(rootPath: string, relative: string): string {
  const root = rootPath.replace(/[\\/]+$/, "");
  return `${root}/${relative.replace(/^[\\/]+/, "")}`;
}

export function navigationRequest(rootPath: string, target: NavigationTarget): NavigationRequest {
  const usable = !target.stale && typeof target.line === "number" && target.line >= 1;
  const tab: NavigationRequest["tab"] = { type: "file", path: absolutePath(rootPath, target.file) };
  if (usable) tab.line = target.line as number;
  const notice = target.stale
    ? "This file changed since the analysis, so it opens at the top. Refresh to get exact lines."
    : null;
  return { tab, notice };
}
