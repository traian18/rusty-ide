import type { AgentActivityEntry, AgentMessage } from "../../../store";
import { appendBoundedText } from "../../../services/boundedTextBuffer";

/** Where the log writes its console messages: the tab's chat in the store. */
export interface ActivitySink {
  add(message: AgentMessage): void;
  update(id: string, content: string, entries: AgentActivityEntry[]): void;
}

function appendActivityEntry(
  entries: AgentActivityEntry[],
  content: unknown,
  kind: AgentActivityEntry["kind"],
): AgentActivityEntry[] {
  const normalized = String(content ?? "").trim();
  if (!normalized) return entries;
  return [...entries, { content: appendBoundedText("", normalized), kind, at: Date.now() }];
}

/** The console message a run's activity (tool output, progress, step changes)
 * is written to, buffered so a burst of output is one store update. */
export class ActivityLog {
  /** The console message being written, if any. */
  messageId: string | null = null;
  private buffer = "";
  private entries: AgentActivityEntry[] = [];
  private flushTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly sink: ActivitySink) {}

  /** Writes to `messageId` (already in the chat) from now on, starting empty. */
  writeTo(messageId: string) {
    this.messageId = messageId;
    this.buffer = "";
    this.entries = [];
  }

  append(content: unknown, kind: AgentActivityEntry["kind"]) {
    const text = String(content ?? "");
    if (!text.trim()) return;
    const update = text.endsWith("\n") ? text : `${text}\n`;
    this.buffer = appendBoundedText(this.buffer, update);
    this.entries = appendActivityEntry(this.entries, text, kind);
  }

  /** Appends to the text alone, without an activity entry: how a hand-over's progress lines are written. */
  appendText(content: string) {
    this.buffer = appendBoundedText(this.buffer, content.endsWith("\n") ? content : `${content}\n`);
  }

  /** `append` and show it at once. */
  report(content: unknown, kind: AgentActivityEntry["kind"] = "update") {
    this.append(content, kind);
    this.flush();
  }

  flush() {
    if (this.messageId) this.sink.update(this.messageId, this.buffer, this.entries);
  }

  scheduleFlush() {
    if (this.flushTimeout) return;
    this.flushTimeout = setTimeout(() => {
      this.flushTimeout = null;
      this.flush();
    }, 150);
  }

  /** Flushes now, dropping a scheduled flush. */
  flushNow() {
    this.cancelScheduledFlush();
    this.flush();
  }

  cancelScheduledFlush() {
    if (this.flushTimeout) clearTimeout(this.flushTimeout);
    this.flushTimeout = null;
  }

  /** Closes the current console message and opens a new one below it. */
  startMessage() {
    this.flush();
    const id = `console_${crypto.randomUUID()}`;
    this.sink.add({ id, role: "console", content: "", timestamp: new Date().toISOString(), phase: "activity" });
    this.writeTo(id);
  }
}
