/** Every command the terminal calls: the native PTY sessions behind each terminal tab. */
import { invoke } from "@tauri-apps/api/core";

/** Calls a Tauri command by name. The app passes the real bridge; tests pass a fake one. */
export type Invoke = <T>(command: string, args: Record<string, unknown>) => Promise<T>;

export interface TerminalClient {
  createSession(sessionId: string, size: { cols: number; rows: number }, cwd: string | null | undefined): Promise<void>;
  /** Sends keystrokes, already encoded as terminal control sequences, to the session. */
  write(sessionId: string, input: string): Promise<void>;
  resize(sessionId: string, cols: number, rows: number): Promise<void>;
  close(sessionId: string): Promise<void>;
}

/** Builds the terminal client on a command bridge. Each method names one Tauri command and its arguments. */
export function createTerminalClient(call: Invoke): TerminalClient {
  return {
    createSession: (sessionId, { cols, rows }, cwd) => call<void>("create_terminal_session", { sessionId, cols, rows, cwd }),
    write: (sessionId, input) => call<void>("write_to_terminal", { sessionId, input }),
    resize: (sessionId, cols, rows) => call<void>("resize_terminal", { sessionId, cols, rows }),
    close: (sessionId) => call<void>("close_terminal_session", { sessionId }),
  };
}

export const terminalClient = createTerminalClient(invoke);
