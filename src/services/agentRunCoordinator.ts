import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "../store";
import { resolveSkill, toSkillData, BUILT_IN_SKILL_IDS } from "../config/skillDefinitions";
import { notify } from "../notificationStore";
import { scheduleTreeRefresh } from "../components/filetree/FileTreePresenter";
import { harness } from "../harness";
import { createRunHost } from "../harness/hostDefaults";
import type { RunHandle } from "../harness/contract";
import { appendBoundedText } from "./boundedTextBuffer";
import { resolveExecutionProvider } from "../store/resolveExecutionProvider";
import { buildAttachmentContext } from "./contextAttachmentService";

const runs = new Map<string, RunHandle<"execute_node">>();

export async function executeNode(nodeId: string, customPrompt?: string, attachments?: { path: string; name: string; isDir?: boolean }[]): Promise<void> {
  const state = useWorkspaceStore.getState();
  let tabId = "";
  let node: any = null;
  for (const [id, context] of Object.entries(state.canvasContexts || {})) {
    const found = context.nodes.find((candidate) => candidate.id === nodeId);
    if (found) { tabId = id; node = found; break; }
  }
  node ||= state.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || node.type !== "taskNode") return;

  const model = node.data.model || state.activeModel;
  const resolution = resolveExecutionProvider(state.customProviders, state.providerStatus, state.activeCustomProviderId, model);
  if (!resolution.ok) {
    notify("Cannot run this node", resolution.message, "error");
    state.setNodeStatus(nodeId, "error");
    return;
  }

  const context = tabId ? state.canvasContexts[tabId] : undefined;
  const nodes = context?.nodes || state.nodes;
  const edges = context?.edges || state.edges;
  const incomingEdges = edges.filter((edge) => edge.target === nodeId);
  const inputFiles = [
    ...incomingEdges
      .map((edge) => nodes.find((candidate) => candidate.id === edge.source))
      .filter((candidate): candidate is any => candidate?.type === "contextNode" && !!candidate.data.path)
      .map((candidate) => ({ path: candidate.data.path, name: candidate.data.fileName, isDir: !!candidate.data.isDir })),
    ...(attachments || []).filter((attachment) => !incomingEdges.some((edge) => nodes.find((candidate) => candidate.id === edge.source)?.data?.path === attachment.path)),
  ];
  const contextDescriptions = incomingEdges
    .map((edge) => nodes.find((candidate) => candidate.id === edge.source))
    .filter((candidate): candidate is any => candidate?.type === "contextNode")
    .map((candidate) => [candidate.data.name && `[${candidate.data.name}]`, candidate.data.description, candidate.data.path && `File: ${candidate.data.path}`].filter(Boolean).join(" — "));
  const upstreamTasks = incomingEdges
    .filter((edge) => edge.sourceHandle === "task-out" && edge.targetHandle === "task-in")
    .map((edge) => nodes.find((candidate) => candidate.id === edge.source))
    .filter((candidate): candidate is any => candidate?.type === "taskNode" && context?.nodeStatus?.[candidate.id] === "success")
    .map((candidate) => ({
      taskId: candidate.id,
      taskName: candidate.data.name || "AI Executor Node",
      prompt: candidate.data.prompt || "",
      files: Object.entries(candidate.data.generatedFileContents || {}).map(([path, content]) => ({ path, content: String(content) })),
    }));
  const upstreamFiles = new Map(upstreamTasks.flatMap((task) => task.files.map((file) => [file.path, file.content] as const)));

  const skill = toSkillData(resolveSkill(state.skills, node.data.skillId || BUILT_IN_SKILL_IDS.BUILD));
  const attachmentContext = await buildAttachmentContext(inputFiles);
  const instruction = customPrompt
    ? `${customPrompt}${attachmentContext ? `\n\n${attachmentContext}` : ""}`
    : [
        state.globalContextSummary && `<general context>\n${state.globalContextSummary}\n</general context>`,
        `<TaskNodeContent>\n${node.data.prompt || ""}\n</TaskNodeContent>`,
        contextDescriptions.length && `<Context>\n${contextDescriptions.join("\n")}\n</Context>`,
        upstreamTasks.length && `<UpstreamTasks>\n${upstreamTasks.map((task) => `[Upstream Task: ${task.taskName}]\n${task.files.map((file) => `[File: ${file.path}]\n${file.content}`).join("\n\n")}`).join("\n\n")}\n</UpstreamTasks>`,
        attachmentContext,
      ].filter(Boolean).join("\n\n");

  state.updateTaskNode(nodeId, { modifiedFiles: [], originalFileContents: {}, generatedFileContents: {} });
  state.clearLogs(nodeId);
  state.setNodeStatus(nodeId, "running");
  state.addLog(nodeId, "Starting task execution in the workspace...");
  state.addGlobalChatMessage(nodeId, { id: `msg_${Date.now()}`, role: "user", content: instruction, timestamp: new Date().toLocaleTimeString(), attachments: inputFiles.length ? inputFiles : undefined });

  const originals = new Map<string, string>();
  const generated = new Map<string, string>();
  const consoleId = `console_${nodeId}_${Date.now()}`;
  let consoleText = "";
  state.addGlobalChatMessage(nodeId, { id: consoleId, role: "console", content: "", timestamp: new Date().toLocaleTimeString() });
  const flushConsole = () => useWorkspaceStore.getState().updateGlobalChatMessage(nodeId, consoleId, consoleText);

  const host = createRunHost({
    readFile: async (path) => generated.get(path) ?? upstreamFiles.get(path) ?? invoke<string>("read_file_disk", { path }),
    writeFile: async (path, content) => {
      if (!originals.has(path)) {
        try { originals.set(path, await invoke<string>("read_file_disk", { path })); }
        catch { originals.set(path, upstreamFiles.get(path) || ""); }
      }
      await invoke("write_file_disk", { path, content });
      generated.set(path, content);
      scheduleTreeRefresh();
    },
  });

  const run = harness.run("execute_node", {
    nodeId, instructions: instruction, model, workspaceRoot: state.rootPath, inputFiles,
    globalContext: state.globalContextSummary || "", contextDescriptions, mcpContext: [], upstreamTaskContext: upstreamTasks,
    chatHistory: [{ role: "user", content: instruction }], customProvider: resolution.provider, skill,
    lspSettings: { ...state.lspSettings, enabled: false },
  }, host, (event) => {
    if (event.kind === "command_output" || event.kind === "token") { consoleText = appendBoundedText(consoleText, event.content); flushConsole(); }
    if (event.kind === "log") { useWorkspaceStore.getState().addLog(nodeId, event.message); consoleText = appendBoundedText(consoleText, `${event.message}\n`); flushConsole(); }
    if (event.kind === "command_complete") scheduleTreeRefresh();
    if (event.kind === "node_status_change") useWorkspaceStore.getState().setNodeStatus(event.targetNodeId, event.status as any);
    if (event.kind === "subagent" && event.subagent) window.dispatchEvent(new CustomEvent("rusty-subagent-update", { detail: { nodeId, subagent: event.subagent } }));
    if (event.kind === "usage") window.dispatchEvent(new CustomEvent("rusty-node-usage", { detail: { nodeId, usage: event.usage } }));
  }, { surface: "canvas-node", tabId: tabId || undefined, canvasId: tabId || undefined, nodeId, displayLabel: String(node.data.name || `Node ${nodeId}`) });

  runs.set(nodeId, run);
  void run.done.then(async (outcome) => {
    runs.delete(nodeId);
    flushConsole();
    if (outcome.status === "completed") {
      const modified = Array.from(new Set([...outcome.result.modified, ...generated.keys()]));
      useWorkspaceStore.getState().updateTaskNode(nodeId, {
        modifiedFiles: modified,
        originalFileContents: Object.fromEntries(modified.map((path) => [path, originals.get(path) || ""])),
        generatedFileContents: Object.fromEntries(modified.filter((path) => generated.has(path)).map((path) => [path, generated.get(path)!])),
      });
      useWorkspaceStore.getState().addGlobalChatMessage(nodeId, { id: `msg_${Date.now()}`, role: "assistant", content: outcome.result.response, timestamp: new Date().toLocaleTimeString() });
      useWorkspaceStore.getState().setNodeStatus(nodeId, "success");
      scheduleTreeRefresh();
      await useWorkspaceStore.getState().loadGitStatus();
      if (tabId) void (await import("../components/tabs/canvas/services/canvasFileService")).canvasFileService.autoSaveCanvas(tabId);
    } else if (outcome.status === "failed") {
      useWorkspaceStore.getState().setNodeStatus(nodeId, "error");
      notify("Execution Error", outcome.error.message, "error");
    }
  });
}

export function stopExecution(nodeId: string): void {
  runs.get(nodeId)?.cancel();
  runs.delete(nodeId);
  const state = useWorkspaceStore.getState();
  state.setNodeStatus(nodeId, "idle");
  state.addLog(nodeId, "Execution stopped by user.");
}

export function hasRunningNodesInTab(tabId: string): boolean {
  const context = useWorkspaceStore.getState().canvasContexts[tabId];
  return !!context && Object.keys(context.nodeStatus || {}).some((nodeId) => context.nodeStatus[nodeId] === "running" && runs.has(nodeId));
}

export function stopAllRunningNodesInTab(tabId: string): void {
  const context = useWorkspaceStore.getState().canvasContexts[tabId];
  Object.keys(context?.nodeStatus || {}).filter((nodeId) => context!.nodeStatus[nodeId] === "running").forEach(stopExecution);
}

if (typeof window !== "undefined") window.addEventListener("tasknode-stop-request", ((event: CustomEvent) => event.detail?.nodeId && stopExecution(event.detail.nodeId)) as EventListener);
