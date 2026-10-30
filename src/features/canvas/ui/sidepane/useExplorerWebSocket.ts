import { useState, useEffect, useRef, useMemo } from "react";
import { snapshotSmartToolSettings } from "../../../settings";
import { snapshotContextCompaction, snapshotJevDecisionTool, snapshotJevRiskReview } from "../../../jev";
import { useWorkspaceStore } from "../../../../store";
import { notify } from "../../../notifications";
import type { SubagentActivity } from "../../../agent-chat/ui";
import {
  resolveSkill,
  toSkillData,
  BUILT_IN_SKILL_IDS,
  GLOBAL_CHAT_DEFAULT_SKILL_ID,
  GLOBAL_CHAT_SKILL_IDS,
} from "../../../skills";
import type { AgentQuestion } from "../../../agent-chat/ui";
import { scheduleTreeRefresh } from "../../../explorer/ui";
import { appendBoundedText } from "../../../../lib/util/boundedTextBuffer";
import { providerModelVariants, selectableModelProviders } from "../../../providers";
import { useSelectableModels } from "../../../providers/ui";
import { resolveExecutionProvider } from "../../../providers";
import { harness } from "../../../../harness";
import type { RunHandle } from "../../../../harness/contract";
import { buildAttachmentContext } from "../../../agent-chat";

import { activeExplorerChatRuns, activeExplorerSubagents, explorerQuestionResolvers, mergeSubagentUpdate, type IncomingSubagent } from "./explorerRunRegistry";
import { createExplorerRunHost } from "./explorerRunHost";
import { useTaskGeneration } from "./useTaskGeneration";
import { useExplorerSummarize } from "./useExplorerSummarize";
export type { GeneratedTaskDraft, GeneratedContextDraft, TaskGenerationFailure } from "./explorerRunRegistry";

export const useExplorerWebSocket = (selectedNode: any) => {
  const selectedNodeId = selectedNode?.id || null;
  const nodeStatus = useWorkspaceStore((state) => state.nodeStatus[selectedNodeId || ""] || "idle");

  const tabId = useMemo(() => {
    if (!selectedNodeId) return undefined;
    const contexts = useWorkspaceStore.getState().canvasContexts;
    for (const tId in contexts) {
      if (contexts[tId].nodes.some((n) => n.id === selectedNodeId)) {
        return tId;
      }
    }
    return undefined;
  }, [selectedNodeId]);

  const [explorerInput, setExplorerInput] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [subagents, setSubagents] = useState<SubagentActivity[]>([]);
  const [agentQuestion, setAgentQuestion] = useState<AgentQuestion | null>(null);
  const explorerRunRef = useRef<RunHandle<"agent_chat"> | null>(null);
  const consoleMessageIdRef = useRef<string | null>(null);
  const consoleBufferRef = useRef<string>("");
  const consoleFlushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addGlobalChatMessage = useWorkspaceStore((state) => state.addGlobalChatMessage);
  const updateGlobalChatMessage = useWorkspaceStore((state) => state.updateGlobalChatMessage);
  const addLog = useWorkspaceStore((state) => state.addLog);
  const setNodeStatus = useWorkspaceStore((state) => state.setNodeStatus);

  const activeModel = useWorkspaceStore((state) => state.activeModel);
  const providers = useWorkspaceStore((state) => state.customProviders);
  const activeCustomProviderId = useWorkspaceStore((state) => state.activeCustomProviderId);
  const providerStatus = useWorkspaceStore((state) => state.providerStatus);
  const filteredProviders = selectableModelProviders(providers, providerStatus, activeCustomProviderId);
  const activeProvider = filteredProviders.find((p) => p.id === activeCustomProviderId);
  const availableModels = activeProvider
    ? activeProvider.models.filter((model) => model.supported !== false).flatMap(providerModelVariants)
    : [];
  const { options: allAvailableModels, unauthenticatedProviders } = useSelectableModels(
    providers,
    providerStatus,
    activeCustomProviderId,
  );

  const exploreModel = (selectedNode?.data?.exploreModel as string) || activeModel;
  const summarizeModel = (selectedNode?.data?.summarizeModel as string) || activeModel;
  const taskGenerationModel = (selectedNode?.data?.taskGenerationModel as string) || exploreModel || activeModel;

  const taskGeneration = useTaskGeneration({ selectedNodeId, selectedNode, nodeStatus, tabId, taskGenerationModel });
  const { isSummarizing, handleExplorerSummarize } = useExplorerSummarize({ selectedNodeId, selectedNode, nodeStatus, tabId });

  useEffect(() => {
    if (selectedNodeId) {
      const existing = activeExplorerChatRuns.get(selectedNodeId);
      if (existing) {
        explorerRunRef.current = existing;
      }
      const history = useWorkspaceStore.getState().globalChatHistory[selectedNodeId] || [];
      const activeConsole = [...history].reverse().find((message) => message.role === "console");
      setStreamingMessageId(useWorkspaceStore.getState().nodeStatus[selectedNodeId] === "running" ? activeConsole?.id || null : null);
      setSubagents(activeExplorerSubagents.get(selectedNodeId) || []);
    } else {
      setSubagents([]);
    }
    setAgentQuestion(null);
  }, [selectedNodeId]);


  useEffect(() => {
    const handleSubagentUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId: string; subagent: SubagentActivity }>).detail;
      if (detail?.nodeId !== selectedNodeId || !detail.subagent?.id) return;
      setSubagents(mergeSubagentUpdate(selectedNodeId, detail.subagent as IncomingSubagent));
    };
    window.addEventListener("rusty-subagent-update", handleSubagentUpdate);
    const handleExplorerSubagentsChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId: string }>).detail;
      if (detail?.nodeId === selectedNodeId) {
        setSubagents(activeExplorerSubagents.get(selectedNodeId) || []);
      }
    };
    window.addEventListener("rusty-explorer-subagents-changed", handleExplorerSubagentsChanged);
    const handleSubagentsReset = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId: string }>).detail;
      if (detail?.nodeId === selectedNodeId) {
        activeExplorerSubagents.set(selectedNodeId, []);
        setSubagents([]);
      }
    };
    window.addEventListener("rusty-subagents-reset", handleSubagentsReset);
    return () => {
      window.removeEventListener("rusty-subagent-update", handleSubagentUpdate);
      window.removeEventListener("rusty-explorer-subagents-changed", handleExplorerSubagentsChanged);
      window.removeEventListener("rusty-subagents-reset", handleSubagentsReset);
    };
  }, [selectedNodeId]);

  // Explorer and task-generation runs are module-scoped (explorerRunRegistry) and outlive the pane.

  const flushConsoleBuffer = () => {
    if (consoleMessageIdRef.current && consoleBufferRef.current) {
      updateGlobalChatMessage(selectedNodeId || "", consoleMessageIdRef.current, consoleBufferRef.current);
    }
  };

  const scheduleConsoleFlush = () => {
    if (consoleFlushTimeoutRef.current) return;
    consoleFlushTimeoutRef.current = setTimeout(() => {
      consoleFlushTimeoutRef.current = null;
      flushConsoleBuffer();
    }, 150);
  };

  const handleExplorerSendMessage = async (
    attachments?: { path: string; name: string; isDir?: boolean }[]
  ) => {
    if (!selectedNodeId) return;
    if ((!explorerInput.trim() && (!attachments || attachments.length === 0)) || nodeStatus === "running") return;

    const attachmentContext = await buildAttachmentContext(attachments);
    const userPromptText = explorerInput.trim() || (attachments && attachments.length > 0 ? "Inspect the attached context." : "");

    const userMessage = {
      role: "user" as const,
      content: userPromptText,
      timestamp: new Date().toLocaleTimeString(),
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
      attachmentContext: attachmentContext || undefined,
    };

    addGlobalChatMessage(selectedNodeId, userMessage);

    const consoleMessageId = `console_${Date.now()}`;
    consoleMessageIdRef.current = consoleMessageId;
    consoleBufferRef.current = "";
    addGlobalChatMessage(selectedNodeId, {
      id: consoleMessageId,
      role: "console",
      content: "",
      timestamp: new Date().toLocaleTimeString(),
    });
    setStreamingMessageId(consoleMessageId);
    activeExplorerSubagents.set(selectedNodeId, []);
    setSubagents([]);

    setExplorerInput("");
    setNodeStatus(selectedNodeId, "running");
    addLog(selectedNodeId, `User prompt: ${userMessage.content}`);

    const rootPath = useWorkspaceStore.getState().rootPath;
    const currentProviders = useWorkspaceStore.getState().customProviders;
    const currentActiveProviderId = useWorkspaceStore.getState().activeCustomProviderId;
    const currentProviderStatus = useWorkspaceStore.getState().providerStatus;
    const currentActiveModel = useWorkspaceStore.getState().activeModel;
    const currentExploreModel = selectedNode?.data?.exploreModel || selectedNode?.data?.model || currentActiveModel;
    const resolution = resolveExecutionProvider(
      currentProviders,
      currentProviderStatus,
      currentActiveProviderId,
      currentExploreModel,
    );
    if (!resolution.ok) {
      notify("Cannot start exploration", resolution.message, "error");
      setNodeStatus(selectedNodeId, "idle");
      return;
    }
    const prov = resolution.provider;
    const chatHistory = useWorkspaceStore.getState().globalChatHistory[selectedNodeId] || [];

    const isTaskNodeChat = selectedNode?.type === "taskNode";

    // TaskNode chat honors the skill selected in its pane. Other node-chat
    // surfaces keep the planning-only behavior, including for older canvases.
    const skills = useWorkspaceStore.getState().skills;
    const requestedSkillId = selectedNode?.data?.skillId as string | undefined;
    const nodeSkillId = isTaskNodeChat
      ? requestedSkillId || BUILT_IN_SKILL_IDS.BUILD
      : requestedSkillId && GLOBAL_CHAT_SKILL_IDS.includes(requestedSkillId)
        ? requestedSkillId
        : GLOBAL_CHAT_DEFAULT_SKILL_ID;
    const resolvedSkill = resolveSkill(skills, nodeSkillId);
    const skillData = toSkillData(resolvedSkill);

    // Build MCP server list from:
    //  1. The active skill's mcpServers (by name → resolved from the store)
    //  2. Any explicit MCP server override selected directly on the node
    const mcpServerName = selectedNode?.data?.mcpServerName as string | undefined;
    const mcpServersMap = useWorkspaceStore.getState().mcpServers;
    const mcpServerNames = Array.from(new Set([
      ...(resolvedSkill?.mcpServers || []),
      ...(mcpServerName ? [mcpServerName] : [])
    ]));
    const mcpServers = mcpServerNames
      .map((name) => mcpServersMap[name])
      .filter((srv): srv is Exclude<typeof srv, undefined> => !!srv);

    const host = createExplorerRunHost({ selectedNode, selectedNodeId, tabId, addLog, onQuestion: setAgentQuestion });
    const run = harness.run(
      "agent_chat",
      {
        tabId: selectedNodeId,
        message: attachmentContext
          ? `${userMessage.content}\n\n${attachmentContext}`
          : userMessage.content,
        workspaceRoot: rootPath,
        model: currentExploreModel,
        chatHistory: chatHistory
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            role: m.role,
            content:
              m.role === "user" && m.attachmentContext
                ? `${m.content}\n\n${m.attachmentContext}`
                : m.content,
          })),
        mcpServers,
        customProvider: prov,
        skill: skillData,
        webSearchApiKeys: useWorkspaceStore.getState().webSearchApiKeys,
        planOnly: !isTaskNodeChat,
        vfsOnly: isTaskNodeChat,
        lspSettings: { ...useWorkspaceStore.getState().lspSettings, enabled: false },
        smartToolSettings: snapshotSmartToolSettings(useWorkspaceStore.getState()),
        jevDecisionTool: snapshotJevDecisionTool(useWorkspaceStore.getState()),
        jevRiskReview: snapshotJevRiskReview(useWorkspaceStore.getState()),
        contextCompaction: snapshotContextCompaction(useWorkspaceStore.getState()),
      },
      host,
      (event) => {
        switch (event.kind) {
          case "command_output":
            consoleBufferRef.current = appendBoundedText(consoleBufferRef.current, event.content);
            scheduleConsoleFlush();
            break;
          case "command_complete":
            scheduleTreeRefresh();
            break;
          case "log":
            addLog(selectedNodeId, event.message);
            consoleBufferRef.current = appendBoundedText(consoleBufferRef.current, `${event.message}\n`);
            scheduleConsoleFlush();
            break;
          case "subagent":
            if (!(event.subagent as IncomingSubagent)?.id) break;
            setSubagents(mergeSubagentUpdate(selectedNodeId, event.subagent as IncomingSubagent));
            window.dispatchEvent(new CustomEvent("rusty-explorer-subagents-changed", { detail: { nodeId: selectedNodeId } }));
            break;
        }
      },
      {
        surface: "canvas-node",
        tabId,
        canvasId: tabId,
        nodeId: selectedNodeId,
        displayLabel: String((selectedNode?.data as any)?.name || (selectedNode?.data as any)?.title || `Node ${selectedNodeId}`),
      },
    );
    run.started
      .then(() => {
        addLog(selectedNodeId, "Connected to agent sidecar for global exploration...");
      })
      .catch(() => {
        // A connection failure also settles `run.done` as "failed" (below),
        // which is where this is actually handled.
      });
    void run.done.then((outcome) => {
      if (outcome.status === "completed") {
        const responseText = outcome.result.response;
        console.log(`[SidePane] Exploration complete! Response length: ${responseText.length}`);
        const assistantMsg = {
          id: `msg_${Date.now()}`,
          role: "assistant" as const,
          content: responseText,
          timestamp: new Date().toLocaleTimeString()
        };
        addGlobalChatMessage(selectedNodeId, assistantMsg);

        if (consoleFlushTimeoutRef.current) {
          clearTimeout(consoleFlushTimeoutRef.current);
          consoleFlushTimeoutRef.current = null;
        }
        if (consoleMessageIdRef.current) {
          updateGlobalChatMessage(selectedNodeId, consoleMessageIdRef.current, "");
        }
        setStreamingMessageId(null);

        setNodeStatus(selectedNodeId, "success");
        addLog(selectedNodeId, "Global exploration completed successfully.");
        activeExplorerChatRuns.delete(selectedNodeId);
        explorerQuestionResolvers.delete(selectedNodeId);
        explorerRunRef.current = null;
      } else if (outcome.status === "failed") {
        const message = outcome.error.message;
        console.log(`[SidePane] Exploration error: ${message}`);
        const errorMsg = {
          id: `msg_${Date.now()}`,
          role: "assistant" as const,
          content: `Error: ${message}`,
          timestamp: new Date().toLocaleTimeString()
        };
        addGlobalChatMessage(selectedNodeId, errorMsg);
        if (consoleFlushTimeoutRef.current) {
          clearTimeout(consoleFlushTimeoutRef.current);
          consoleFlushTimeoutRef.current = null;
        }
        if (consoleMessageIdRef.current) {
          updateGlobalChatMessage(selectedNodeId, consoleMessageIdRef.current, "");
        }
        setStreamingMessageId(null);
        setNodeStatus(selectedNodeId, "error");
        addLog(selectedNodeId, `Global exploration error: ${message}`);
        activeExplorerChatRuns.delete(selectedNodeId);
        explorerQuestionResolvers.delete(selectedNodeId);
        explorerRunRef.current = null;
        notify("Exploration Error", `Exploration failed with error: ${message}`, "error");
      }
    });
    explorerRunRef.current = run;
    activeExplorerChatRuns.set(selectedNodeId, run);
  };

  const handleStopExplorer = () => {
    const run = selectedNodeId ? activeExplorerChatRuns.get(selectedNodeId) : explorerRunRef.current;
    run?.cancel();
    if (selectedNodeId) {
      activeExplorerChatRuns.delete(selectedNodeId);
      explorerQuestionResolvers.delete(selectedNodeId);
    }
    explorerRunRef.current = null;
    setStreamingMessageId(null);
    setNodeStatus(selectedNodeId || "", "idle");
  };

  const handleAgentQuestionAnswer = (answer: string) => {
    const run = selectedNodeId ? activeExplorerChatRuns.get(selectedNodeId) : explorerRunRef.current;
    if (!agentQuestion || !run || !selectedNodeId) return;
    explorerQuestionResolvers.get(selectedNodeId)?.(answer);
    explorerQuestionResolvers.delete(selectedNodeId);
    addLog(selectedNodeId || "", `User answer: ${answer}`);
    setAgentQuestion(null);
  };


  return {
    explorerInput,
    setExplorerInput,
    isSummarizing,
    ...taskGeneration,
    showSettings,
    setShowSettings,
    handleExplorerSendMessage,
    handleExplorerSummarize,
    handleStopExplorer,
    handleAgentQuestionAnswer,
    streamingMessageId,
    subagents,
    agentQuestion,
    exploreModel,
    summarizeModel,
    taskGenerationModel,
    providers: filteredProviders,
    activeCustomProviderId,
    availableModels,
    allAvailableModels,
    unauthenticatedProviders
  };
};
