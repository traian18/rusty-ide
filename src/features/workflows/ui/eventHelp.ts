import type { RuleEvent } from "../model";

/** What each rule event means, as shown beside the event's heading. */
export const EVENT_HELP: Record<RuleEvent, string> = {
  RunStart: "once, when a run starts",
  BeforeModelRequest: "before every model request",
  PreToolUse: "before a tool runs — can deny, ask, allow or rewrite arguments",
  PostToolUse: "after a tool succeeds — can inject or rewrite the result",
  PostToolUseFailure: "after a tool fails",
  ProfileEntered: "when a switch lands on this profile",
};
