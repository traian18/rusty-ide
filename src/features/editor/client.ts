/** Every command the editor calls: the open-safety check, image reads and saving a file to disk. */
import { invoke } from "@tauri-apps/api/core";

/** Calls a Tauri command by name. The app passes the real bridge; tests pass a fake one. */
export type Invoke = <T>(command: string, args: Record<string, unknown>) => Promise<T>;

/** What `check_file_open_safety` reports for a file. */
export interface FileOpenSafety {
  kind: "safe" | "binary" | "too_large";
  size_bytes: number;
}

export interface EditorClient {
  /** Whether the file is safe to open as text under a size limit. */
  checkOpenSafety(path: string, maxBytes: number): Promise<FileOpenSafety>;
  /** The file's bytes as base64, for image previews. */
  readAsBase64(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}

/** Builds the editor client on a command bridge. Each method names one Tauri command and its arguments. */
export function createEditorClient(call: Invoke): EditorClient {
  return {
    checkOpenSafety: (path, maxBytes) => call<FileOpenSafety>("check_file_open_safety", { path, maxBytes }),
    readAsBase64: (path) => call<string>("read_file_as_base64", { path }),
    writeFile: (path, content) => call<void>("write_file_disk", { path, content }),
  };
}

export const editorClient = createEditorClient(invoke);
