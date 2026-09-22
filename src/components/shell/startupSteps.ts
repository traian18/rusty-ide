import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "../../store";
import type { StartupStep, StepContext } from "../../startup/types";

/**
 * The application's actual startup steps -- deliberately NOT under
 * src/startup/ (unlike the generic executor: types.ts, runStartup.ts,
 * withTimeout.ts), because these need the real store and Tauri's `invoke`,
 * and src/startup/layering.test.ts forbids exactly that import for the
 * generic machinery. Lives next to AppBootstrapBoundary.tsx, its only
 * consumer, the same way consoleFormat.ts lives next to DevLogBridge.tsx.
 */

const SECURE_CONFIG_TIMEOUT_MS = 3_000;
const WORKSPACE_RESTORE_TIMEOUT_MS = 5_000;

/**
 * Restores the workspace loadSecureConfig found saved
 * (pendingWorkspaceRestorePath), if any. A separate function/step from
 * loadSecureConfig itself so it can carry its own, longer timeout budget
 * without a slow directory listing counting against secure-config's
 * critical one (createIntegrationSlice.ts).
 *
 * Non-destructive, unlike setRootPath: never resets tabs/canvases/nodes,
 * so re-running it (a Retry after a timeout) can't destroy work done since
 * "Continue without waiting".
 *
 * Also the sole owner of flipping secureConfigLoaded for the "a saved path
 * exists" case -- set in `finally`, UNCONDITIONALLY (not gated on
 * ctx.signal.aborted), so a step that times out still eventually unblocks
 * saveSecureConfig once its non-cancellable invoke() actually settles in
 * the background, rather than leaving it permanently guarded for the rest
 * of the session. Only the rootPath/fileTree write itself is gated on the
 * signal, so a late result after a timeout/abort is discarded rather than
 * landing out of order.
 */
export async function restoreWorkspace(ctx: StepContext): Promise<void> {
  const path = useWorkspaceStore.getState().pendingWorkspaceRestorePath;
  if (!path) {
    useWorkspaceStore.setState({ secureConfigLoaded: true });
    return;
  }
  try {
    const fileTree: any[] = await invoke("get_directory_structure", { rootDir: path });
    if (ctx.signal.aborted) return;
    useWorkspaceStore.setState({ rootPath: path, fileTree, pendingWorkspaceRestorePath: null });
    await useWorkspaceStore.getState().loadWorkspaceData();
  } catch (error) {
    console.error("Failed to load last workspace folder:", error);
  } finally {
    useWorkspaceStore.setState({ secureConfigLoaded: true });
  }
}

export const STARTUP_STEPS: StartupStep[] = [
  {
    id: "secure-config",
    label: "Loading configuration…",
    critical: true,
    timeoutMs: SECURE_CONFIG_TIMEOUT_MS,
    run: async () => {
      await useWorkspaceStore.getState().loadSecureConfig();
    },
  },
  {
    id: "workspace-restore",
    label: "Restoring your workspace…",
    timeoutMs: WORKSPACE_RESTORE_TIMEOUT_MS,
    dependsOn: ["secure-config"],
    run: restoreWorkspace,
  },
];
