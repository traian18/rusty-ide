/** The native reads that parsing needs. Parsers take bytes and never call Tauri themselves. */
import { invoke } from "@tauri-apps/api/core";

export interface DocumentClient {
  /** The file's content as base64; tries the 100MB reader first, then the general one. */
  readBase64(path: string): Promise<string>;
}

export const documentClient: DocumentClient = {
  async readBase64(path) {
    try {
      return await invoke<string>("read_binary_file_base64", { path });
    } catch (err: unknown) {
      try {
        return await invoke<string>("read_file_as_base64", { path });
      } catch {
        throw err;
      }
    }
  },
};


