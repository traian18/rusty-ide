import type { AgentMessage } from "../store";
import { appendBoundedText } from "./boundedTextBuffer";

/** Keep model message boundaries across tool turns and automatic continuations.
 * Flushes are batched by the view; switching messages always flushes the old one. */
export class AgentChatResponseStream {
  private current?: { sourceId?: string; message: AgentMessage };
  private lastAssistantText = "";
  constructor(
    private readonly add: (message: AgentMessage) => void,
    private readonly update: (id: string, content: string) => void,
  ) {}

  append(content: string, sourceId?: string) {
    if (!this.current || this.current.sourceId !== sourceId) {
      this.flush();
      const message: AgentMessage = {
        id: `assistant_${crypto.randomUUID()}`, role: "assistant", content: "", timestamp: new Date().toISOString(),
      };
      this.current = { sourceId, message };
      message.content = appendBoundedText("", content, 500_000);
      this.add({ ...message });
    } else {
      this.current.message.content = appendBoundedText(this.current.message.content, content, 500_000);
    }
    this.lastAssistantText = this.current.message.content;
  }

  progress(content: string) {
    this.flush();
    this.current = undefined;
    this.add({ id: `progress_${crypto.randomUUID()}`, role: "assistant", content, timestamp: new Date().toISOString() });
  }

  flush() {
    if (this.current) this.update(this.current.message.id, this.current.message.content);
  }

  finish(response?: string) {
    this.flush();
    // The result normally repeats the last model message. Never replace earlier
    // progress, nor duplicate the final answer. A distinct result gets its own row.
    if (response && response !== this.lastAssistantText) this.progress(response);
  }
}
