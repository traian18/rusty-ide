// The backend's copy of the model-limits catalog (src-tauri harness/model_limits.rs).
import { invoke } from "@tauri-apps/api/core";
import type { LimitsEntries } from "./lookup";

/** The app's copy, checked against LiteLLM at most once a day; null when there is none yet. */
export function fetchModelLimits(): Promise<{ entries: LimitsEntries } | null> {
  return invoke("model_limits");
}
