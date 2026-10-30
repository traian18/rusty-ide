// ============================================================
// modelSwitch/index.ts -- the "Keep the model on a warm cache"
// optimisation as callers use it: ask before moving a running
// conversation to another model. Off, every switch is allowed.
// ============================================================

import { recordRefusedModelSwitch } from "../stats";
import { isOptimizationEnabled } from "../switches";
import { estimateConversationTokens, judgeModelSwitch, type ModelSwitch, type ModelSwitchVerdict } from "./warmCache";

export type { ModelSwitch, ModelSwitchVerdict };
export { estimateConversationTokens };

export function checkModelSwitch(change: ModelSwitch): ModelSwitchVerdict {
  if (!isOptimizationEnabled("warm-cache-guard")) return { allowed: true, reason: "The warm-cache guard is off." };
  const verdict = judgeModelSwitch(change);
  if (!verdict.allowed) recordRefusedModelSwitch();
  return verdict;
}
