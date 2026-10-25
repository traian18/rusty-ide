import { invoke } from "@tauri-apps/api/core";
import type { AgentMessage } from "../../../store";
import { userPrompts } from "../../../services/promptHistory";

export interface SavedChat {
  path: string;
  name: string;
  savedAt: string;
  preview: string;
  messageCount: number;
  /** The prompts the user sent in this chat, oldest first: what the chat box offers on the up arrow. */
  prompts: string[];
}

/** A chat file as saved by `AgentChatSaveQueue`. Fields other than `messages` are read by their own readers. */
export interface SavedChatFile {
  messages: AgentMessage[];
  savedAt?: string;
  historySummary?: unknown;
  modifiedFiles?: unknown;
  workflow?: unknown;
  flowSwitching?: unknown;
  workflowCheckpoint?: unknown;
  followedSpec?: unknown;
}

export async function readSavedChat(path: string): Promise<SavedChatFile> {
  const parsed = JSON.parse(await invoke<string>("read_file_disk", { path }));
  return { ...parsed, messages: parsed.messages || [] };
}

function summarize(file: { path: string; name: string }, chat: SavedChatFile): SavedChat {
  const firstUser = chat.messages.find((m) => m.role === "user");
  return {
    path: file.path,
    name: file.name,
    savedAt: chat.savedAt || "",
    preview: firstUser ? firstUser.content.replace(/@([^\s@]+)/g, "$1").slice(0, 80) : "(empty conversation)",
    messageCount: chat.messages.length,
    prompts: userPrompts(chat.messages),
  };
}

/** The workspace's saved chats (`.rusty/chats`), newest first. A chat that cannot be read is left out. */
export async function listSavedChats(rootPath: string): Promise<SavedChat[]> {
  const tree = await invoke<{ name: string; path: string }[]>("get_directory_structure", { rootDir: `${rootPath}/.rusty/chats` });
  const loaded: SavedChat[] = [];
  for (const file of (tree || []).filter((f) => f.name.endsWith(".json"))) {
    try {
      loaded.push(summarize(file, await readSavedChat(file.path)));
    } catch (e) {
      console.error(`Failed to read chat ${file.path}:`, e);
    }
  }
  return loaded.sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""));
}
