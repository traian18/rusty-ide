import { useWorkspaceStore, type AgentMessage } from "../../../../store";
import { useChatStore } from "./chatStore";

const NEW_CHAT_TITLE = "New chat";

/** A chat's name: its first request, shortened. */
export function chatTitle(messages: AgentMessage[] | undefined): string {
  const first = messages?.find((message) => message.role === "user")?.content.trim();
  if (!first) return NEW_CHAT_TITLE;
  const line = first.split("\n")[0].replace(/@([^\s@]+)/g, "$1");
  return line.length > 32 ? `${line.slice(0, 31)}…` : line;
}

/** Whether the chat is the one its tab shows. */
export function isShownChat(chatId: string): boolean {
  const view = useChatStore.getState().chats[chatId];
  return Boolean(view) && useChatStore.getState().tabs[view.tabId]?.activeChatId === chatId;
}

/** How a notice names the chat it is about: by its title when another chat is shown. */
export function noticeFor(chatId: string, text: string): string {
  return isShownChat(chatId) ? text : `${chatTitle(useWorkspaceStore.getState().agentChats[chatId])}: ${text}`;
}
