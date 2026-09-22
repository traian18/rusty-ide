import React, { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useWorkspaceStore } from "../store";
import { resolveTheme } from "../theme";
import styles from "./LocalTerminal.module.css";

interface LocalTerminalProps {
  sessionId: string;
  cwd?: string;
  isActive: boolean;
}

export const LocalTerminal: React.FC<LocalTerminalProps> = ({ sessionId, cwd, isActive }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const activeThemeId = useWorkspaceStore((state) => state.activeThemeId);
  const isSessionCreatedRef = useRef<boolean>(false);
  const isActiveRef = useRef<boolean>(isActive);
  const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const writeChainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    if (!containerRef.current) return;

    const terminalTheme = resolveTheme(useWorkspaceStore.getState().activeThemeId).terminal;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: 'Fira Code, Menlo, Monaco, Consolas, "Courier New", monospace',
      allowProposedApi: false,
      convertEol: false,
      scrollback: 10000,
      fastScrollModifier: "alt",
      fastScrollSensitivity: 5,
      macOptionIsMeta: true,
      theme: {
        background: terminalTheme.background,
        foreground: terminalTheme.foreground,
        cursor: terminalTheme.cursor,
        selectionBackground: terminalTheme.selection,
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(containerRef.current);

    const fitAndResize = (notifyBackend: boolean) => {
      if (!containerRef.current || containerRef.current.clientWidth <= 0 || containerRef.current.clientHeight <= 0) {
        return;
      }

      try {
        fitAddon.fit();
        const cols = term.cols;
        const rows = term.rows;
        const lastSize = lastSizeRef.current;
        if (cols <= 0 || rows <= 0 || (lastSize?.cols === cols && lastSize?.rows === rows)) {
          return;
        }

        lastSizeRef.current = { cols, rows };
        if (notifyBackend && isSessionCreatedRef.current) {
          invoke("resize_terminal", { sessionId, cols, rows }).catch((err) => {
            console.error("Failed to resize terminal:", err);
          });
        }
      } catch (err) {
        console.warn("xterm fit failed:", err);
      }
    };

    if (containerRef.current.clientWidth > 0 && containerRef.current.clientHeight > 0) {
      fitAndResize(false);
    }

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;
    isSessionCreatedRef.current = false;
    writeChainRef.current = Promise.resolve();

    let unlisten: (() => void) | null = null;
    const inputDisposable = term.onData((data) => {
      if (!isSessionCreatedRef.current) return;

      // xterm already produces the exact terminal control sequences. Preserve
      // their order but otherwise pass them straight through to the native PTY.
      writeChainRef.current = writeChainRef.current
        .then(async () => {
          await invoke("write_to_terminal", { sessionId, input: data });
        })
        .catch((err) => {
          console.error("Failed to write to terminal:", err);
        });
    });

    const initTerminal = async () => {
      try {
        const terminalCwd = cwd || rootPath;
        
        const unsubscribe = await listen<number[]>(`terminal-output-${sessionId}`, (event) => {
          term.write(Uint8Array.from(event.payload));
        });

        const unsubscribeExit = await listen(`terminal-exit-${sessionId}`, () => {
          term.write("\r\n[Process completed]\r\n");
        });

        unlisten = () => {
          unsubscribe();
          unsubscribeExit();
        };

        const cols = lastSizeRef.current?.cols || term.cols;
        const rows = lastSizeRef.current?.rows || term.rows;
        await invoke("create_terminal_session", {
          sessionId,
          cols,
          rows,
          cwd: terminalCwd,
        });
        isSessionCreatedRef.current = true;

        fitAndResize(true);

        if (isActive) {
          term.focus();
        }

      } catch (err: any) {
        term.write(`\r\nError initializing terminal: ${err.message || String(err)}\r\n`);
      }
    };

    initTerminal();

    const resizeObserver = new ResizeObserver((entries) => {
      if (!isActiveRef.current) return;
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;

      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
      }

      resizeFrameRef.current = requestAnimationFrame(() => {
        fitAndResize(false);
        if (resizeTimerRef.current !== null) {
          window.clearTimeout(resizeTimerRef.current);
        }
        resizeTimerRef.current = window.setTimeout(() => fitAndResize(true), 80);
      });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      if (unlisten) unlisten();
      inputDisposable.dispose();
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
      }
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
      }
      isSessionCreatedRef.current = false;
      invoke("close_terminal_session", { sessionId }).catch((err) => {
        console.error("Failed to close terminal session:", err);
      });
      term.dispose();
    };
  }, [sessionId, cwd, rootPath]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const terminalTheme = resolveTheme(activeThemeId).terminal;
    terminal.options.theme = {
      background: terminalTheme.background,
      foreground: terminalTheme.foreground,
      cursor: terminalTheme.cursor,
      selectionBackground: terminalTheme.selection,
    };
  }, [activeThemeId]);

  // Recalculate size and focus when tab becomes active
  useEffect(() => {
    if (isActive && terminalRef.current && fitAddonRef.current) {
      const timer = setTimeout(() => {
        const terminal = terminalRef.current;
        const fitAddon = fitAddonRef.current;
        const container = containerRef.current;
        if (fitAddon && terminal && container && container.clientWidth > 0 && container.clientHeight > 0) {
          try {
            fitAddon.fit();
            const cols = terminal.cols;
            const rows = terminal.rows;
            const lastSize = lastSizeRef.current;
            if (cols > 0 && rows > 0 && (lastSize?.cols !== cols || lastSize?.rows !== rows)) {
              lastSizeRef.current = { cols, rows };
              invoke("resize_terminal", { sessionId, cols, rows }).catch((err) => {
                console.error("Failed to resize terminal:", err);
              });
            }
            terminal.focus();
          } catch (err) {
            console.warn("xterm fit error on activate:", err);
          }
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isActive, sessionId]);

  return (
    <div className={styles.shell}>
      <div ref={containerRef} className={styles.terminal} />
    </div>
  );
};
