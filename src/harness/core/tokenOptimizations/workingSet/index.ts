// ============================================================
// workingSet/index.ts -- the "Carry the working set across turns"
// optimisation as callers use it: record a chat's tool calls, and give the
// next turn's prompt the section. Off, nothing is recorded or added.
// ============================================================

import { failOpen } from "../safeguards/guards";
import { isOptimizationEnabled } from "../switches";
import { recordToolUse, workingSetSection } from "./workingSet";

export { forgetWorkingSet, WORKING_SET_LIMITS } from "./workingSet";

export function noteToolUse(chat: string, tool: string, args: unknown): void {
  if (isOptimizationEnabled("working-set")) failOpen(() => recordToolUse(chat, tool, args), undefined);
}

export function workingSetFor(chat: string): string {
  return isOptimizationEnabled("working-set") ? failOpen(() => workingSetSection(chat), "") : "";
}
