import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "../../../store";
import type { VfsChangedDetail } from "../../../services/vfs";
import { getMonacoLanguageId, resolveLanguage } from "../../../services/languageRegistry";
import { getImageMimeType } from "../../../services/imageFile";

/** check_file_open_safety's verdict for a file (REFACTOR_PLAN.md PR 6 commit 8). */
export type FileSafety = { kind: "safe" } | { kind: "binary"; sizeBytes: number } | { kind: "too_large"; sizeBytes: number };

export interface ImagePreview {
  dataUrl: string;
  sizeBytes: number;
}

/** Canvas (VFS) files are always safe to open, and so is a file the check failed on. */
export async function checkFileSafety(path: string, vfsTabId: string | undefined): Promise<FileSafety> {
  if (vfsTabId) return { kind: "safe" };
  try {
    const thresholdBytes = useWorkspaceStore.getState().editorFileSafety.largeFileThresholdBytes;
    const raw: any = await invoke("check_file_open_safety", { path, maxBytes: thresholdBytes });
    return raw.kind === "safe" ? { kind: "safe" } : { kind: raw.kind, sizeBytes: raw.size_bytes };
  } catch (err) {
    console.warn("check_file_open_safety failed, proceeding as safe:", err);
    return { kind: "safe" };
  }
}

/** The language a shebang line names, for a file whose name alone reads as
 * plain text (an extensionless script); null otherwise (REFACTOR_PLAN.md
 * PR 6 commit 5). */
export function shebangLanguageFor(path: string, content: string): string | null {
  if (getMonacoLanguageId(path) !== "plaintext") return null;
  const resolved = resolveLanguage(path, content.split("\n", 1)[0] ?? "");
  return resolved.id !== "plaintext" ? resolved.id : null;
}

function base64Padding(base64: string): number {
  if (base64.endsWith("==")) return 2;
  return base64.endsWith("=") ? 1 : 0;
}

/** The decoded byte count of base64 text: exact, and cheaper than a second
 * stat round trip just for the caption's file size. */
export function base64ByteLength(base64: string): number {
  return Math.floor((base64.length * 3) / 4) - base64Padding(base64);
}

/** Images skip check_file_open_safety and VfsRegistry entirely: the
 * safety check's NUL-byte sniff would just classify them "binary" anyway
 * (SVG being the one exception, since it's real text), and
 * VfsRegistry.readFile expects UTF-8 text, which would corrupt raw image
 * bytes rather than error cleanly on them. */
export async function readImagePreview(path: string): Promise<ImagePreview> {
  const base64: string = await invoke("read_file_as_base64", { path });
  return { dataUrl: `data:${getImageMimeType(path)};base64,${base64}`, sizeBytes: base64ByteLength(base64) };
}

function samePath(changed: string, path: string): boolean {
  return changed === path || path.endsWith(changed) || changed.endsWith(path);
}

/** Whether a VFS change on `canvasTabId` touches the file at `path`. */
export function vfsChangeAffects(detail: VfsChangedDetail | undefined, canvasTabId: string, path: string): boolean {
  if (!detail || detail.tabId !== canvasTabId) return false;
  return !detail.paths || detail.paths.some((changed) => samePath(changed, path));
}
