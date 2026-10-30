import type { Message } from "./chatTypes";

export type ChatGroup =
  | { type: "console"; message: Message; phase?: string }
  | { type: "messages"; id: string; isUser: boolean; messages: Message[]; phase?: string };

type MessagesGroup = Extract<ChatGroup, { type: "messages" }>;

/** Consecutive messages from the same side, in the same phase, share one group. */
function continues(group: ChatGroup | undefined, isUser: boolean, phase: string): group is MessagesGroup {
  if (group?.type !== "messages") return false;
  return group.isUser === isUser && group.phase === phase;
}

export function groupChatMessages(messages: Message[]): ChatGroup[] {
  const groups: ChatGroup[] = [];

  for (const message of messages) {
    const phase = message.phase || "activity";  // Default for backward compat

    if (message.role === "console") {
      groups.push({ type: "console", message, phase });
      continue;
    }

    const isUser = message.role === "user";
    const lastGroup = groups[groups.length - 1];
    if (continues(lastGroup, isUser, phase)) {
      lastGroup.messages.push(message);
    } else {
      groups.push({ type: "messages", id: message.id, isUser, messages: [message], phase });
    }
  }

  return groups;
}

/** A console message shows only once it says something, or while it is the one streaming. */
export function isShownMessage(message: Message, streamingMessageId: string | null, live: boolean): boolean {
  if (message.role !== "console") return true;
  if (message.content.trim() || message.activityEntries?.length) return true;
  return streamingMessageId === message.id && live;
}

export function formatTimestamp(timestamp: string): string {
  if (!timestamp) return "";
  try {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return timestamp;
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return timestamp;
  }
}
