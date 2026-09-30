import { invoke } from "@tauri-apps/api/core";
import type { AgentMessage } from "../store/types";

/** Old conversation files have no modifiedFiles field. */
export function readModifiedFiles(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((path): path is string => typeof path === "string" && path.length > 0))]
    : [];
}

/** The workflow a saved conversation follows (absent in older files). */
export function readChatWorkflow(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Each conversation owns its save queue. Capture JSON before an async
 * write so closing a tab or switching chats cannot change what is saved. */
export class AgentChatSaveQueue {
  path: string | null;
  private chatId: string | null = null;
  private pending: Promise<void> = Promise.resolve();

  constructor(path: string | null = null) {
    this.path = path;
  }

  /** `workflow` is the path of the workflow this chat follows, if any. */
  save(rootDir: string, tabId: string, messages: AgentMessage[], modifiedFiles: string[], workflow?: string, workflowCheckpoint?: unknown): Promise<void> {
    const chatId = this.chatId ??= `agent_${tabId}_${crypto.randomUUID()}`;
    const content = JSON.stringify({
      tabId, messages, modifiedFiles: readModifiedFiles(modifiedFiles), savedAt: new Date().toISOString(),
      ...(workflow ? { workflow } : {}),
      ...(workflowCheckpoint ? { workflowCheckpoint } : {}),
    });
    this.pending = this.pending.catch(() => {}).then(async () => {
      if (this.path) {
        await invoke("write_file_disk", { path: this.path, content });
      } else {
        this.path = await invoke<string>("save_chat_history", { rootDir, chatId, content });
      }
    });
    return this.pending;
  }

  flushed(): Promise<void> {
    return this.pending;
  }
}
