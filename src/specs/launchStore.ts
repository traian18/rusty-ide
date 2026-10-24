/** A Specify or Plan run waiting for the Agent tab it was opened in to pick it up. */
import { create } from "zustand";

import { notify } from "../notificationStore";
import { useWorkspaceStore } from "../store";
import { workspacePrefix } from "./pure";
import type { SpecRun } from "./run";

export interface PendingSpecRun {
  tabId: string;
  run: SpecRun;
  /** What the message box starts with. */
  message: string;
  /** Send the message as it is, without waiting for the person (a batch of capability specs). */
  autoSend?: boolean;
  /** The runs to start one after another once this one completes. */
  queue?: QueuedSpecRun[];
}

export interface QueuedSpecRun {
  run: SpecRun;
  message: string;
}

interface SpecLaunchState {
  pending: PendingSpecRun | null;
  request(pending: PendingSpecRun): void;
  clear(): void;
}

export const useSpecLaunch = create<SpecLaunchState>()((set) => ({
  pending: null,
  request: (pending) => set({ pending }),
  clear: () => set({ pending: null }),
}));

/** Opens an Agent tab set up for the run; the person reads the message, adds notes and sends it. */
export function openSpecRun(run: SpecRun, message: string): void {
  openTabFor({ run, message });
}

/** Opens an Agent tab that writes several specs one after another without waiting for a send. A run that fails or is stopped ends the batch. */
export function openSpecBatch(runs: readonly QueuedSpecRun[]): void {
  const [first, ...queue] = runs;
  if (first) openTabFor({ ...first, autoSend: true, queue });
}

function openTabFor(request: Omit<PendingSpecRun, "tabId"> & { run: SpecRun }): void {
  const { run } = request;
  const workspace = useWorkspaceStore.getState();
  // The run works in the workspace folder: the repository must be it or one of its folders.
  if (workspacePrefix(run.root, workspace.rootPath) === null) {
    notify("Open this repository as the workspace", "Spec runs work in the workspace folder, and this repository is not in it.", "info");
    return;
  }
  const tabId = workspace.openTab({ type: "agent" });
  useSpecLaunch.getState().request({ ...request, tabId });
}
