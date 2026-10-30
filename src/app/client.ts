/** The commands the app shell calls itself: the workspace file watcher and the terminal log. */
import { invoke } from "@tauri-apps/api/core";

/** Calls a Tauri command by name. The app passes the real bridge; tests pass a fake one. */
export type Invoke = <T>(command: string, args: Record<string, unknown>) => Promise<T>;

export interface AppClient {
  watchWorkspace(rootDir: string): Promise<void>;
  logToTerminal(level: string, message: string): Promise<void>;
}

/** Builds the app client on a command bridge. Each method names one Tauri command and its arguments. */
export function createAppClient(call: Invoke): AppClient {
  return {
    watchWorkspace: (rootDir) => call<void>("watch_workspace", { rootDir }),
    logToTerminal: (level, message) => call<void>("log_to_terminal", { level, message }),
  };
}

export const appClient = createAppClient(invoke);
