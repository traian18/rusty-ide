/** Every command the agent chat calls: reading and writing files, deleting them, and saving chat history. */
import { invoke } from "@tauri-apps/api/core";

/** Calls a Tauri command by name. The app passes the real bridge; tests pass a fake one. */
export type Invoke = <T>(command: string, args: Record<string, unknown>) => Promise<T>;

export interface AgentChatClient {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFileOrDir(path: string): Promise<void>;
  /** Saves one chat's history and returns the path it was written to. */
  saveChatHistory(rootDir: string, chatId: string, content: string): Promise<string>;
}

/** Builds the agent chat client on a command bridge. Each method names one Tauri command and its arguments. */
export function createAgentChatClient(call: Invoke): AgentChatClient {
  return {
    readFile: (path) => call("read_file_disk", { path }),
    writeFile: (path, content) => call("write_file_disk", { path, content }),
    deleteFileOrDir: (path) => call("delete_file_or_dir", { path }),
    saveChatHistory: (rootDir, chatId, content) => call("save_chat_history", { rootDir, chatId, content }),
  };
}

/** The app's agent chat client, backed by the Tauri bridge. */
export const agentChatClient: AgentChatClient = createAgentChatClient(invoke);
