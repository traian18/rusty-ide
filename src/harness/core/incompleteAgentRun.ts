import type { AgentEvent } from "@rusty/harness-sdk";

/** A successful terminal event is insufficient when the runtime stopped just
 * after a tool. Resume the existing session, never replay the tool ourselves. */
export class IncompleteAgentRun {
  private sawTool = false;
  private responseAfterTool = "";
  private outputLimited = false;
  private continuations = 0;
  observe(event: AgentEvent) {
    if ("ToolCallRequested" in event || "ToolCallCompleted" in event) {
      this.sawTool = true;
      this.responseAfterTool = "";
    } else if ("AssistantTextDelta" in event) {
      this.responseAfterTool += event.AssistantTextDelta.delta;
    }
  }
  outputLimitReached() {
    this.outputLimited = true;
    this.sawTool = true; // Subsequent empty continuation turns still need an answer.
  }
  completion(): "done" | "continue" | "exhausted" {
    // Be conservative: a short, standalone promise is not the promised answer.
    // Never reject an answer merely because it contains future-tense language.
    const text = this.responseAfterTool.trim();
    const announcementOnly = text.length < 300 && !text.includes("\n")
      && /^(?:I['’]ll|I will|Let me)\s+(?:now\s+)?(?:provide|present|generate|prepare|create|write|summarize|analyse|analyze|inspect|check|review)\b[^.!?]*[.!]?$/.test(text);
    if (!this.outputLimited && (!this.sawTool || (text && !announcementOnly))) return "done";
    if (this.continuations >= 2) return "exhausted";
    this.continuations++;
    this.outputLimited = false;
    this.responseAfterTool = "";
    return "continue";
  }
}
export const CONTINUE_AGENT_PROMPT = "Continue the original task from the current state. The previous turn ended without a complete answer (it may have reached the output limit or only announced the next step). Use the existing tool results; do not repeat completed changes or research. Deliver the requested findings directly in chat for analysis requests, rather than creating a document file unless the user asked for one. Keep the answer concise enough to fit in one response; perform any necessary remaining tool work in smaller steps. Do not bypass denied permissions or retry quota/authentication failures. If blocked, explain the blocker. A promise to provide an answer is not the answer.";
