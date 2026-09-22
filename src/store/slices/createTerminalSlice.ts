import type { DevLog } from "../types";
import type { WorkspaceSliceCreator } from "../sliceTypes";

export const createTerminalSlice: WorkspaceSliceCreator = (set) => ({
  devLogs: [],
  showDevConsole: false,
  terminalTabs: [],
  activeTerminalTabId: null,

  addDevLog: (type, text) => set((state) => {
    const newLog: DevLog = {
      id: `dev_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      type,
      text: text.length <= 8_000 ? text : `${text.slice(0, 8_000)}… [truncated]`,
      timestamp: new Date().toLocaleTimeString(),
    };
    return { devLogs: [...state.devLogs.slice(-299), newLog] };
  }),

  clearDevLogs: () => set({ devLogs: [] }),
  setShowDevConsole: (showDevConsole) => set({ showDevConsole }),

  initTerminalState: (isDev) => set((state) => {
    if (state.terminalTabs.length > 0) return {};
    const terminalTabs = [];
    if (isDev) terminalTabs.push({ id: "dev-logs", name: "Dev Logs", type: "dev-logs" as const });
    terminalTabs.push({ id: `terminal-${Date.now()}`, name: "Terminal 1", type: "local" as const });
    return { terminalTabs, activeTerminalTabId: terminalTabs[0].id };
  }),

  addTerminalTab: (type, cwd) => set((state) => {
    const id = `terminal-${Date.now()}`;
    const localCount = state.terminalTabs.filter((tab) => tab.type === "local").length + 1;
    const name = type === "dev-logs" ? "Dev Logs" : `Terminal ${localCount}`;
    return {
      terminalTabs: [...state.terminalTabs, { id, name, type, cwd }],
      activeTerminalTabId: id,
      showDevConsole: true,
    };
  }),

  closeTerminalTab: (id) => set((state) => {
    const terminalTabs = state.terminalTabs.filter((tab) => tab.id !== id);
    let activeTerminalTabId = state.activeTerminalTabId;
    if (activeTerminalTabId === id) {
      const index = state.terminalTabs.findIndex((tab) => tab.id === id);
      activeTerminalTabId = terminalTabs.length > 0
        ? terminalTabs[Math.min(index, terminalTabs.length - 1)].id
        : null;
    }
    return { terminalTabs, activeTerminalTabId };
  }),

  setActiveTerminalTabId: (activeTerminalTabId) => set({ activeTerminalTabId }),
});
