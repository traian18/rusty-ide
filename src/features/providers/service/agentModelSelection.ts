/** Agent mode owns its model choice, including AUTO, across chats and restarts. */
export const AGENT_MODEL_SELECTION_STORAGE_KEY = "rusty_agent_selected_model";

export function loadAgentModelSelection(): string | undefined {
  try {
    const value = localStorage.getItem(AGENT_MODEL_SELECTION_STORAGE_KEY);
    return value?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function saveAgentModelSelection(model: string): void {
  try {
    localStorage.setItem(AGENT_MODEL_SELECTION_STORAGE_KEY, model);
  } catch {
    // The in-memory selection still works if storage is unavailable.
  }
}
