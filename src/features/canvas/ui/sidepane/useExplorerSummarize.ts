import { useState } from "react";
import { useWorkspaceStore } from "../../../../store";
import { VfsRegistry } from "../../service/vfs";
import { notify } from "../../../notifications";
import { resolveSkill, toSkillData, BUILT_IN_SKILL_IDS } from "../../../skills";
import { resolveExecutionProvider } from "../../../providers";
import { harness } from "../../../../harness";
import { createRunHost } from "../../../../harness/hostDefaults";

interface SummarizeParams {
  selectedNodeId: string | null;
  selectedNode: any;
  nodeStatus: string;
  tabId: string | undefined;
}

/** Summarises the node's recent conversation into the node's summary field. */
export function useExplorerSummarize({ selectedNodeId, selectedNode, nodeStatus, tabId }: SummarizeParams) {
  const [isSummarizing, setIsSummarizing] = useState(false);
  const addLog = useWorkspaceStore((state) => state.addLog);
  const setNodeStatus = useWorkspaceStore((state) => state.setNodeStatus);
  const setGlobalContextSummary = useWorkspaceStore((state) => state.setGlobalContextSummary);
  const updateNode = useWorkspaceStore((state) => state.updateTaskNode);

  const handleExplorerSummarize = () => {
    if (!selectedNodeId) return;
    const chatHistory = useWorkspaceStore.getState().globalChatHistory[selectedNodeId] || [];
    if (chatHistory.length === 0) {
      notify("Summarize", "No conversation to summarize.", "info");
      return;
    }
    if (nodeStatus === "running" || isSummarizing) return;

    setIsSummarizing(true);
    setNodeStatus(selectedNodeId, "running");
    addLog(selectedNodeId, "Summarizing conversation (focused on recent discussion)...");

    // Focus on the most recent portion of the discussion. The user typically
    // iterates over many topics and acts on the latest one, so the summary
    // should capture the current intent rather than earlier tangents.
    const RECENT_WINDOW = 8;
    const recentMessages = chatHistory.slice(-RECENT_WINDOW);
    const totalCount = chatHistory.length;
    const truncatedCount = Math.max(0, totalCount - recentMessages.length);
    const conversationText = recentMessages
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");

    const rootPath = useWorkspaceStore.getState().rootPath;
    const currentProviders = useWorkspaceStore.getState().customProviders;
    const currentActiveProviderId = useWorkspaceStore.getState().activeCustomProviderId;
    const currentProviderStatus = useWorkspaceStore.getState().providerStatus;
    const currentActiveModel = useWorkspaceStore.getState().activeModel;
    const currentSummarizeModel = selectedNode?.data?.summarizeModel || currentActiveModel;
    const resolution = resolveExecutionProvider(
      currentProviders,
      currentProviderStatus,
      currentActiveProviderId,
      currentSummarizeModel,
    );
    if (!resolution.ok) {
      notify("Cannot summarize", resolution.message, "error");
      setNodeStatus(selectedNodeId, "idle");
      setIsSummarizing(false);
      return;
    }
    const prov = resolution.provider;

    // Always use task-auditor skill for summarization on this node type.
    const skills = useWorkspaceStore.getState().skills;
    const auditorSkill = resolveSkill(skills, BUILT_IN_SKILL_IDS.TASK_AUDITOR);
    const skillData = toSkillData(auditorSkill);

    const truncationNote = truncatedCount > 0
      ? `\n\nNote: This conversation had ${totalCount} total messages; only the last ${recentMessages.length} are included because the user iterates over many topics and the current focus is the most recent discussion.`
      : "";

    // Not tracked on explorerRunRef/activeExplorerChatRuns: those are typed to
    // agent_chat's AgentChatRun (send-message flow) specifically, and (as
    // before this migration) summarize has no external stop affordance --
    // the previous code's assignment of this to the same ref as the chat
    // socket was dead weight, since handleStopExplorer only ever sent an
    // agent_chat_stop, which a global_explore-capability run never understood.
    const summarizeHost = createRunHost({ readFile: (path) => VfsRegistry.getOrCreate(tabId).readFile(path) });
    const summarizeHandle = harness.run(
      "global_explore",
      {
        nodeId: selectedNodeId,
        prompt: `Please summarize the recent portion of the following conversation concisely. The user typically discusses many topics in sequence but only acts on the latest one, so focus the summary on the most recent exchange: what the user wants, what was decided or agreed, and the immediate next steps.${truncationNote}\n\n${conversationText}`,
        workspaceRoot: rootPath,
        model: currentSummarizeModel,
        chatHistory: [],
        customProvider: prov,
        skill: skillData,
      },
      summarizeHost,
      (event) => {
        if (event.kind === "log") addLog(selectedNodeId, event.message);
      },
      {
        surface: "canvas-node",
        tabId,
        canvasId: tabId,
        nodeId: selectedNodeId,
        displayLabel: `Summarize · ${String((selectedNode?.data as any)?.name || selectedNodeId)}`,
      },
    );
    void summarizeHandle.done.then((outcome) => {
      if (outcome.status === "completed") {
        const summary = outcome.result.response;
        setGlobalContextSummary(summary);
        updateNode(selectedNodeId, { summary });
        setNodeStatus(selectedNodeId, "success");
        addLog(selectedNodeId, `Conversation summarized (${summary.length} chars).`);
        setIsSummarizing(false);
      } else if (outcome.status === "failed") {
        setNodeStatus(selectedNodeId, "error");
        addLog(selectedNodeId, `Summarize error: ${outcome.error.message}`);
        setIsSummarizing(false);
        notify("Summarize Error", `Summarization failed with error: ${outcome.error.message}`, "error");
      } else {
        setNodeStatus(selectedNodeId, "idle");
        setIsSummarizing(false);
      }
    });
  };

  return { isSummarizing, handleExplorerSummarize };
}
