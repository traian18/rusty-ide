import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "../../../../store";
import { selectTabById } from "../../../../store/tabSelectors";

const AUTOSAVE_DEBOUNCE_MS = 1_500;
const AUTOSAVE_MIN_INTERVAL_MS = 5_000;
const saveQueues = new Map<string, Promise<void>>();
type AutoSaveState = { timer: ReturnType<typeof setTimeout> | null; inFlight: boolean; dirty: boolean; lastSavedAt: number; pendingPromise: Promise<string | null> | null; pendingResolve: ((value: string | null) => void) | null; };
const autoSaveStates = new Map<string, AutoSaveState>();
const sanitizedCanvasName = (title: string) => title.replace(/[^a-zA-Z0-9_\-]/g, "_").toLowerCase() || "untitled_pipeline";
const canvasDirectory = (rootPath: string) => `${rootPath}/.rusty/canvas`;
const canvasPath = (rootPath: string, fileName: string) => `${canvasDirectory(rootPath)}/${fileName}.json`;

const enqueueSave = async <T,>(key: string, operation: () => Promise<T>): Promise<T> => {
  const previous = saveQueues.get(key) || Promise.resolve();
  let release = () => {};
  const current = previous.catch(() => {}).then(() => new Promise<void>((resolve) => { release = resolve; }));
  saveQueues.set(key, current);
  await previous.catch(() => {});
  try { return await operation(); } finally { release(); if (saveQueues.get(key) === current) saveQueues.delete(key); }
};

const resolveCanvasFilePath = async (rootPath: string, title: string, tabId: string) => {
  const base = sanitizedCanvasName(title);
  for (let index = 1; index <= 10_000; index += 1) {
    const candidate = canvasPath(rootPath, index === 1 ? base : `${base}_${index}`);
    try { if (JSON.parse(await invoke<string>("read_file_disk", { path: candidate }))?.id === tabId) return candidate; }
    catch (error) { if (String(error).toLowerCase().includes("file not found")) return candidate; }
  }
  throw new Error(`Could not allocate a unique canvas filename for "${title}"`);
};

const saveCanvasNow = async (tabId: string, title: string, rootPath: string, refreshFileTree: boolean) => {
  const context = useWorkspaceStore.getState().canvasContexts[tabId] || { nodes: [], edges: [], nodeLogs: {}, nodeStatus: {}, globalChatHistory: {}, edgeReconciliationStatus: {} };
  // VFS and reconciliation fields are deliberately not emitted. Legacy files remain loadable.
  const payload = { id: tabId, title, nodes: context.nodes, edges: context.edges, nodeLogs: context.nodeLogs, nodeStatus: context.nodeStatus, globalChatHistory: context.globalChatHistory, contextNodesHidden: context.contextNodesHidden ?? false, contextRevealedTasks: context.contextRevealedTasks ?? [] };
  const path = await resolveCanvasFilePath(rootPath, title, tabId);
  await invoke("write_file_disk", { path, content: JSON.stringify(payload, null, 2) });
  if (refreshFileTree) useWorkspaceStore.getState().setFileTree(await invoke<any[]>("get_directory_structure", { rootDir: rootPath }));
  return path;
};

const getState = (tabId: string): AutoSaveState => {
  let state = autoSaveStates.get(tabId);
  if (!state) { state = { timer: null, inFlight: false, dirty: false, lastSavedAt: 0, pendingPromise: null, pendingResolve: null }; autoSaveStates.set(tabId, state); }
  return state;
};
const schedule = (tabId: string, delay = AUTOSAVE_DEBOUNCE_MS) => {
  const state = getState(tabId); if (state.inFlight) return;
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => { state.timer = null; void runAutoSave(tabId); }, Math.max(delay, state.lastSavedAt + AUTOSAVE_MIN_INTERVAL_MS - Date.now()));
};
const runAutoSave = async (tabId: string) => {
  const auto = getState(tabId); if (auto.inFlight || !auto.dirty) return;
  auto.inFlight = true; auto.dirty = false;
  const resolve = auto.pendingResolve; auto.pendingResolve = null; auto.pendingPromise = null;
  const state = useWorkspaceStore.getState(); const title = selectTabById(state, tabId)?.title;
  if (!state.rootPath || !title || !state.canvasContexts[tabId]) { resolve?.(null); auto.inFlight = false; return; }
  try { const path = await enqueueSave(`${state.rootPath}::${sanitizedCanvasName(title)}`, () => saveCanvasNow(tabId, title, state.rootPath, false)); auto.lastSavedAt = Date.now(); resolve?.(path); }
  catch (error) { console.error("[canvasFileService] Auto-save failed:", error); resolve?.(null); }
  finally { auto.inFlight = false; if (auto.dirty) schedule(tabId); }
};

export const canvasFileService = {
  getCanvasDir: canvasDirectory,
  getCanvasFilePath: canvasPath,
  sanitizeFileName: sanitizedCanvasName,
  saveCanvas: async (tabId: string, title: string) => { const state = useWorkspaceStore.getState(); if (!state.rootPath) throw new Error("No active workspace directory loaded"); return enqueueSave(`${state.rootPath}::${sanitizedCanvasName(title)}`, () => saveCanvasNow(tabId, title, state.rootPath, true)); },
  autoSaveCanvas: (tabId: string) => { const state = getState(tabId); state.dirty = true; if (!state.pendingPromise) state.pendingPromise = new Promise((resolve) => { state.pendingResolve = resolve; }); schedule(tabId); return state.pendingPromise; },
  loadCanvasFromFile: async (filePath: string): Promise<any> => JSON.parse(await invoke<string>("read_file_disk", { path: filePath })),
};
