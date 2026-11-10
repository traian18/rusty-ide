// What a chat's run sends when it continues the chat's kept session (run/conversation.ts): the
// session already holds the earlier conversation, tool results included, so only the open to-do
// reminder and the new message go in; promptText's flattened history and working-set note would
// repeat what the session has.
import type { AgentChatInput } from "../../contract/capabilities";
import { openTodosReminder } from "./todoTool";

export function agentChatContinuationPrompt(input: AgentChatInput): string {
  return `${input.planOnly ? "" : openTodosReminder(input.tabId)}${input.message}`;
}
