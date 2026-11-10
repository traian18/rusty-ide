// One rusty-core session per chat, kept between its messages.
//
// A chat's single-agent run used to create a session, send the whole earlier conversation as
// text and close the session when it settled, so every message started from nothing: the files
// it read and the commands it ran were gone, the context estimate restarted near zero, and the
// session's own compaction could never be reached. Now the session stays open while the chat
// goes on, and the next message is added to the same conversation, like any coding agent's
// chat. Core keeps every message, tool results included, and compacts them near the model's
// limit.
//
// A run continues the chat's session only when nothing it was built on changed: the recipe (model,
// skill, mode, tools, compaction) is the same, and the chat holds exactly what the session saw
// plus the exchange it produced. Anything else (another model, a workflow run in between, a chat
// loaded after a restart) starts a fresh session from the flattened history, as before. A run
// that fails or is cancelled gives its session up; closing the chat closes it.

import type { CapabilityInput, CapabilityName } from "../../contract";
import { agentChatContinuationPrompt } from "../definitions/agentChatContinuation";
import type { BridgeEvent, CoreEngine } from "../engine/CoreEngineClient";
import type { SessionRecipe } from "../SessionRecipe";
import { ignoreFailure } from "./failures";

/** The prompt for a run that continues its chat's session, by capability. */
const CONTINUATION_PROMPTS: Partial<Record<CapabilityName, (input: never) => string>> = {
  agent_chat: agentChatContinuationPrompt,
};

interface Kept {
  id: string;
  engine: CoreEngine;
  /** The recipe the session was created with, as a comparable key. */
  key: string;
  /** Ids of the chat messages the session has seen, oldest first; null while a run is open. */
  seen: string[] | null;
}

/** A chat's kept session; events of the session go to whichever run uses it now. */
export class Conversation {
  private kept: Kept | undefined;
  private route: ((event: BridgeEvent) => void) | undefined;

  constructor(readonly chatId: string) {}

  /** The kept session id, when `history` (the chat before the new message) is what it saw plus its last exchange. */
  continuable(key: string, history: readonly HistoryEntry[]): string | undefined {
    const kept = this.kept;
    if (!kept?.seen || kept.key !== key || !extendsByOneExchange(kept.seen, history)) return undefined;
    return kept.id;
  }

  /** A run is using the kept session right now. */
  busy(): boolean {
    return Boolean(this.kept) && this.kept!.seen === null;
  }

  owns(sessionId: string): boolean {
    return this.kept?.id === sessionId;
  }

  /** Sends the session's events to `onEvent` from now on. */
  listen(onEvent: (event: BridgeEvent) => void): void {
    this.route = onEvent;
    if (this.kept) this.kept.seen = null;
  }

  /** Takes over a newly created session, closing the one kept before, and subscribes to it once. */
  async adopt(engine: CoreEngine, id: string, key: string, onEvent: (event: BridgeEvent) => void): Promise<void> {
    this.close();
    this.kept = { id, engine, key, seen: null };
    this.route = onEvent;
    await engine.subscribe(id, (event) => {
      // Core ended the session itself: nothing is left to keep or close.
      if (event.kind === "closed" && this.kept?.id === id) this.kept = undefined;
      this.route?.(event);
    });
  }

  /** The run using the session ended. Completed: keep it, having seen `history` and this run's
   * message; anything else gives it up. */
  ended(sessionId: string, completed: boolean, history: readonly HistoryEntry[]): void {
    if (!this.owns(sessionId)) return;
    if (!completed) return this.close();
    this.kept!.seen = history.flatMap((entry) => (entry.id ? [entry.id] : []));
  }

  /** Closes the kept session. */
  close(): void {
    const kept = this.kept;
    this.kept = undefined;
    this.route = undefined;
    if (kept) void kept.engine.closeSession(kept.id).catch(ignoreFailure(`closing chat session ${kept.id}`));
  }
}

export interface HistoryEntry {
  id?: string;
  role: string;
}

/** `history` is `seen`, then the message that run answered, then its answer. */
function extendsByOneExchange(seen: readonly string[], history: readonly HistoryEntry[]): boolean {
  if (history.length < seen.length + 2) return false;
  if (seen.some((id, index) => history[index]?.id !== id)) return false;
  const [message, ...answer] = history.slice(seen.length);
  return message!.role === "user" && answer.every((entry) => entry.role === "assistant");
}

const conversations = new Map<string, Conversation>();

/** The chat's conversation, when this run can keep or continue a session: a chat's own
 * single-agent run (not a workflow). */
export function conversationFor<K extends CapabilityName>(capability: K, input: CapabilityInput<K>): Conversation | undefined {
  const fields = input as { tabId?: unknown; workflow?: unknown };
  if (!CONTINUATION_PROMPTS[capability] || fields.workflow || typeof fields.tabId !== "string" || !fields.tabId) return undefined;
  let conversation = conversations.get(fields.tabId);
  if (!conversation) conversations.set(fields.tabId, (conversation = new Conversation(fields.tabId)));
  return conversation;
}

/** Closes a chat's kept session; the chat was closed, cleared or replaced. */
export function releaseConversation(chatId: string): void {
  conversations.get(chatId)?.close();
  conversations.delete(chatId);
}

/** The prompt a continuing run sends instead of `promptText`. */
export function continuationPrompt<K extends CapabilityName>(capability: K, input: CapabilityInput<K>): string {
  return CONTINUATION_PROMPTS[capability]!(input as never);
}

/** What a session was created with, as a key: a run continues it only when its own key is the same. */
export function recipeKey(recipe: SessionRecipe): string {
  return stableJson(recipe);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([name, item]) => `${JSON.stringify(name)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** A run's session: the chat's kept one when it can be continued, otherwise a new one. */
export async function openSession(options: {
  engine: CoreEngine;
  recipe: SessionRecipe;
  key: string;
  conversation: Conversation | undefined;
  history: readonly HistoryEntry[];
  onEvent: (event: BridgeEvent) => void;
  /** Called with the session id before any of its events reach `onEvent`. */
  bind: (sessionId: string) => void;
  /** Whether the run settled while the session was being created: then it is closed at once. */
  settled: () => boolean;
}): Promise<{ id: string; continued: boolean } | undefined> {
  const { engine, onEvent } = options;
  // Another run of the chat still uses the kept session: this one gets its own, which is not kept.
  const conversation = options.conversation?.busy() ? undefined : options.conversation;
  const kept = conversation?.continuable(options.key, options.history);
  if (kept) {
    options.bind(kept);
    conversation!.listen(onEvent);
    return { id: kept, continued: true };
  }
  const id = await engine.createSession(options.recipe);
  if (options.settled()) {
    void engine.closeSession(id).catch(ignoreFailure(`closing session ${id}`));
    return undefined;
  }
  options.bind(id);
  if (conversation) await conversation.adopt(engine, id, options.key, onEvent);
  else await engine.subscribe(id, onEvent);
  return { id, continued: false };
}
