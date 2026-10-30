/** Every command the skills feature calls: the files under `.rusty/skills`. */
import { invoke } from "@tauri-apps/api/core";

/** Calls a Tauri command by name. The app passes the real bridge; tests pass a fake one. */
export type Invoke = <T>(command: string, args: Record<string, unknown>) => Promise<T>;

export interface SkillFileEntry {
  name: string;
  path: string;
}

export interface SkillsClient {
  createDirectory(path: string): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  deleteItem(path: string): Promise<void>;
  listDirectory(path: string): Promise<SkillFileEntry[]>;
  readFile(path: string): Promise<string>;
}

/** Builds the skills client on a command bridge. Each method names one Tauri command and its arguments. */
export function createSkillsClient(call: Invoke): SkillsClient {
  return {
    createDirectory: (path) => call<void>("create_directory", { path }),
    writeFile: (path, content) => call<void>("write_file_disk", { path, content }),
    deleteItem: (path) => call<void>("delete_file_or_dir", { path }),
    listDirectory: (path) => call<SkillFileEntry[]>("get_directory_structure", { rootDir: path }),
    readFile: (path) => call<string>("read_file_disk", { path }),
  };
}

export const skillsClient = createSkillsClient(invoke);
