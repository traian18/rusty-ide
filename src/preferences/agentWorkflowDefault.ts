/**
 * Whether the user opted out of new Agent chats following the starter
 * Plan → Build → Verify workflow.
 *
 * New chats follow it by default. Choosing "Single agent" in a chat's workflow
 * picker is the opt-out, remembered so the next new chat starts the same way;
 * choosing any workflow clears it. Read and written only from user actions and
 * chat setup, never at store creation.
 */

export const AGENT_WORKFLOW_OPT_OUT_STORAGE_KEY = "rusty_agent_workflow_opt_out";

export function loadAgentWorkflowOptOut(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(AGENT_WORKFLOW_OPT_OUT_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveAgentWorkflowOptOut(optedOut: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (optedOut) localStorage.setItem(AGENT_WORKFLOW_OPT_OUT_STORAGE_KEY, "true");
    else localStorage.removeItem(AGENT_WORKFLOW_OPT_OUT_STORAGE_KEY);
  } catch {
    // Best-effort persistence in restricted storage environments
  }
}
