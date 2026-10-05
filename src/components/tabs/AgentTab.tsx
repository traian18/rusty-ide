import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { snapshotSmartToolSettings } from "../../store/smartToolSettingsSnapshot";
import { snapshotFlowRouter, snapshotJevDecisionTool, snapshotJevRiskReview, snapshotStepModels } from "../../services/jevDecisionToolSnapshot";
import { chooseFlow, type FlowCandidate, type FlowChoice } from "../../services/autoFlowSelection";
import { History, Trash2, Plus, RefreshCw, PanelLeftClose, PanelLeft, CheckCircle2, FolderGit2, FileText } from "lucide-react";
import { useWorkspaceStore, AgentMessage, type AgentActivityEntry } from "../../store";
import { resolveSkill, toSkillData, DEFAULT_SKILL_ID, BUILT_IN_SKILL_IDS } from "../../config/skillDefinitions";
import { CustomSelect } from "../CustomSelect";
import { invoke } from "@tauri-apps/api/core";
import { Chat, SubagentActivity } from "../ui/Chat";
import { ChatQueryRail } from "../ui/ChatQueryRail";
import { findChatSearchMatches, createChatSearchIndex, type ChatSearchIndex } from "../ui/chatSearch";
import { AgentQuestion, ChatInput } from "../ui/ChatInput";
import { notify } from "../../notificationStore";
import { refreshTree, scheduleTreeRefresh } from "../filetree/FileTreePresenter";
import { appendBoundedText } from "../../services/boundedTextBuffer";
import { useSelectableModels } from "../../hooks/useSelectableModels";
import { resolveExecutionProvider } from "../../store/resolveExecutionProvider";
import { harness } from "../../harness";
import { createRunHost } from "../../harness/hostDefaults";
import { commandPermissionService } from "../../services/commandPermissionService";
import type { RunHandle } from "../../harness/contract";
import { registerTabStop, unregisterTabStop } from "../../tabs/tabStopRegistry";
import { TokenBadge, TokenUsageLike } from "../ui/TokenBadge/TokenBadge";
import { AgentChatSaveQueue, readChatWorkflow, readFlowSwitching, readModifiedFiles } from "../../services/agentChatPersistence";
import { AgentChatResponseStream } from "../../services/agentChatResponseStream";
import { buildAttachmentContext } from "../../services/contextAttachmentService";
import type { TabOfType } from "../../tabs/types";
import { executionObservability } from "../../observability/executionStore";
import { jevFlowRecord, jevSelectionRecord } from "../../observability/modelSelectionRecord";
import {
  AUTO_MODEL_ID,
  AUTO_LEVEL_LABELS,
  resolveLevelCandidates,
  type LevelCandidates,
  selectIntelligentModel,
  findOpenRouterJevProvider,
  IntelligentModelSelectionError,
} from "../../services/intelligentModelSelector";
import type { DecideStepUpConfig } from "../../harness/core/decideToolConfig";
import { workflowReportFor } from "../../services/workflowReport";
import { workflowInputFor, readWorkflowCheckpoint, workflowUsesContext, priorWorkflowContext, conversationResults, withConversation, failedVerificationReport, type FailedWorkflowCheckpoint } from "../../harness/core/workflowRun";
import { behaviorService } from "./behaviors/behaviorService";
import { BUILTIN_WORKFLOW_PATH, STARTER_PROFILES, STARTER_WORKFLOW, workflowKind } from "./behaviors/starterFlow";
import { AUTO_FLOW, shortWorkflowId, workflowMayEdit, workflowRoute, workflowSwitchTargets } from "./behaviors/flowCatalog";
import { loadAgentModelSelection, saveAgentModelSelection } from "../../preferences/agentModelSelection";
import { useWorkflowRunStore } from "./behaviors/workflowRunStore";
import { AgentWorkflowBar, type WorkflowChoice } from "./behaviors/AgentWorkflowBar";
import { recentPrompts, userPrompts } from "../../services/promptHistory";
import type { JsonObject } from "./behaviors/behaviorModel";

interface AgentTabProps {
  tab: TabOfType<"agent">;
}

interface SavedChat {
  path: string;
  name: string;
  savedAt: string;
  preview: string;
  messageCount: number;
  /** The prompts the user sent in this chat, oldest first: what the chat box offers on the up arrow. */
  prompts: string[];
}

/** What one run of a turn is started from. A workflow that hands over starts the next run from this. */
interface LaunchPlan {
  workflowDefinition: Record<string, unknown> | undefined;
  workflowId: string;
  /** What the run starts from when a previous run handed over (else the chat's last result). */
  context?: string;
  /** Hand-overs still allowed in this turn. */
  switchesLeft: number;
  /** Workflows already run in this turn (by short id): none is run twice. */
  visited: string[];
}

const MAX_FLOW_SWITCHES_PER_MESSAGE = 2;

function appendActivityEntry(
  entries: AgentActivityEntry[],
  content: unknown,
  kind: AgentActivityEntry["kind"],
): AgentActivityEntry[] {
  const normalized = String(content ?? "").trim();
  if (!normalized) return entries;
  return [...entries, { content: appendBoundedText("", normalized), kind }];
}
export const AgentTab: React.FC<AgentTabProps> = ({ tab }) => {
  const customProviders = useWorkspaceStore((state) => state.customProviders);
  const activeCustomProviderId = useWorkspaceStore((state) => state.activeCustomProviderId);
  const providerStatus = useWorkspaceStore((state) => state.providerStatus);
  const activeModel = useWorkspaceStore((state) => state.activeModel);
  const setActiveModel = useWorkspaceStore((state) => state.setActiveModel);
  const agentChats = useWorkspaceStore((state) => state.agentChats[tab.id] || []);
  const addAgentMessage = useWorkspaceStore((state) => state.addAgentMessage);
  const updateAgentMessage = useWorkspaceStore((state) => state.updateAgentMessage);
  const setAgentMessages = useWorkspaceStore((state) => state.setAgentMessages);
  const clearAgentMessages = useWorkspaceStore((state) => state.clearAgentMessages);
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const openTab = useWorkspaceStore((state) => state.openTab);
  const skills = useWorkspaceStore((state) => state.skills);
  const activeSkillId = useWorkspaceStore((state) => state.activeSkillId);
  const setActiveSkill = useWorkspaceStore((state) => state.setActiveSkill);
  const setAgentTabBusy = useWorkspaceStore((state) => state.setAgentTabBusy);
  const intelligentModelSelectionSettings = useWorkspaceStore(
    (state) => state.intelligentModelSelectionSettings,
  );

  const savedAgentModelRef = useRef(loadAgentModelSelection());
  const [selectedModel, setSelectedModel] = useState(() => savedAgentModelRef.current ?? activeModel);
  const [selectedSkillId, setSelectedSkillId] = useState<string>(activeSkillId || DEFAULT_SKILL_ID);
  const [message, setMessage] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [modifiedFiles, setModifiedFilesState] = useState<string[]>([]);
  const modifiedFilesRef = useRef<string[]>([]);
  const setModifiedFiles = (files: string[]) => {
    modifiedFilesRef.current = readModifiedFiles(files);
    setModifiedFilesState(modifiedFilesRef.current);
  };
  const [subagents, setSubagents] = useState<SubagentActivity[]>([]);
  const [runUsage, setRunUsage] = useState<TokenUsageLike | null>(null);
  const [streamingLabel, setStreamingLabel] = useState("Model is thinking…");
  const [agentQuestions, setAgentQuestions] = useState<AgentQuestion[]>([]);
  const [chatSearch, setChatSearch] = useState("");
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const [activeQueryId, setActiveQueryId] = useState<string>();
  const [scrollTarget, setScrollTarget] = useState<{ messageId: string; token: number }>();
  const navigationTokenRef = useRef(0);
  const agentQuestion = agentQuestions[0] || null;
  const hasActiveSubagents = subagents.some((subagent) =>
    subagent.status === "queued" || subagent.status === "running" || subagent.status === "background"
  );
  const isAgentBusy = isStreaming || hasActiveSubagents;
  const hasSelectedSkill = selectedSkillId !== null && skills.some((skill) => skill.id === selectedSkillId);
  const queryMetadata = useMemo(() => agentChats
    .filter((chat) => chat.role === "user")
    .map((chat, index) => ({ id: chat.id, index: index + 1, label: chat.content.trim() || `Query ${index + 1}` })), [agentChats]);
  const searchIndexRef = useRef<ChatSearchIndex | undefined>(undefined);
  const searchIndex = useMemo(() => {
    searchIndexRef.current = createChatSearchIndex(agentChats, searchIndexRef.current);
    return searchIndexRef.current;
  }, [agentChats]);
  const searchMatches = useMemo(() => findChatSearchMatches(agentChats, chatSearch, searchIndex), [agentChats, chatSearch, searchIndex]);
  const activeSearchMatch = searchMatches[activeSearchIndex];
  const navigateToMessage = useCallback((messageId: string) => {
    navigationTokenRef.current += 1;
    setScrollTarget({ messageId, token: navigationTokenRef.current });
  }, []);
  const selectQuery = useCallback((messageId: string) => {
    setActiveQueryId(messageId);
    navigateToMessage(messageId);
  }, [navigateToMessage]);
  useEffect(() => {
    setActiveSearchIndex(0);
  }, [chatSearch]);

  // Chat history panel state
  const [showHistory, setShowHistory] = useState(true);
  const [chatHistory, setChatHistory] = useState<SavedChat[]>([]);
  // This chat's prompts, then the saved chats' when it has fewer than the box offers. Reuses the
  // chats the history panel already read, so it costs no extra file access.
  const promptHistory = useMemo(() => recentPrompts(userPrompts(agentChats), chatHistory), [agentChats, chatHistory]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [activeChatPath, setActiveChatPath] = useState<string | null>(null);
  const chatHistoryLoadIdRef = useRef(0);
  const previousRootPathRef = useRef(rootPath);

  const agentRunRef = useRef<RunHandle<"agent_chat"> | null>(null);
  // The saved workflow (.rusty/workflows) this chat follows instead of a
  // single agent loop. Per chat: saved in the chat file, restored on load.
  // The ref serves callbacks that outlive a render (saves, sends).
  const [chatWorkflow, setChatWorkflowState] = useState<string | undefined>();
  const chatWorkflowRef = useRef<string | undefined>(undefined);
  const [workflowCheckpoint, setWorkflowCheckpointState] = useState<FailedWorkflowCheckpoint>();
  const workflowCheckpointRef = useRef<FailedWorkflowCheckpoint | undefined>(undefined);
  const setWorkflowCheckpoint = (value: unknown) => {
    const checkpoint = readWorkflowCheckpoint(value);
    workflowCheckpointRef.current = checkpoint;
    setWorkflowCheckpointState(checkpoint);
  };
  const [workflowDocument, setWorkflowDocument] = useState<JsonObject | undefined>();
  const [workflowRunning, setWorkflowRunning] = useState(false);
  const workflowCatalogVersion = useWorkflowRunStore((state) => state.catalogVersion);
  const agentWorkflowRequest = useWorkflowRunStore((state) => state.agentRequest);
  const workflowRuns = useWorkflowRunStore((state) => state.runs);
  const [workflowOptions, setWorkflowOptions] = useState<WorkflowChoice[]>([]);
  const workflowOptionsRef = useRef<WorkflowChoice[]>([]);
  workflowOptionsRef.current = workflowOptions;
  // Whether a running workflow may hand over to another at a step boundary. Per chat, like the workflow.
  const [flowSwitching, setFlowSwitchingState] = useState(false);
  const flowSwitchingRef = useRef(false);
  // With Auto, the workflow chosen for the latest message (drives the bar's steps).
  const [autoWorkflow, setAutoWorkflow] = useState<string | undefined>();
  // How the previous workflow run ended, which the Auto router sees.
  const lastWorkflowRunRef = useRef<{ name: string; status: string } | undefined>(undefined);
  const questionResolversRef = useRef<Map<string, (answer: string) => void>>(new Map());
  const consoleMessageIdRef = useRef<string | null>(null);
  const consoleBufferRef = useRef<string>("");
  const consoleEntriesRef = useRef<AgentActivityEntry[]>([]);
  const responseStreamRef = useRef<AgentChatResponseStream | null>(null);
  const chatSaveQueueRef = useRef(new AgentChatSaveQueue());
  const consoleFlushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamingResponseFlushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isStreamingRef = useRef(false);
  const lastUserMessageIdRef = useRef<string | null>(null);
  const lastConsoleMessageIdRef = useRef<string | null>(null);
  const delegatedSubagentIdsRef = useRef(new Set<string>());
  const activeWorkflowAgentStepRef = useRef<string | null>(null);

  const { options: baseModelOptions, unauthenticatedProviders } = useSelectableModels(
    customProviders,
    providerStatus,
    activeCustomProviderId,
  );

  useEffect(() => {
    if (!rootPath) {
      setWorkflowOptions([]);
      return;
    }
    let cancelled = false;
    void Promise.all([behaviorService.loadWorkflows(rootPath), behaviorService.loadProfiles(rootPath)])
      .then(([{ documents }, { documents: profiles }]) => {
        if (cancelled) return;
        // Whether a workflow edits is read from the profiles its steps run under.
        const library = [...profiles.map((profile) => profile.document), ...STARTER_PROFILES];
        setWorkflowOptions(
          documents.map(({ path, document }) => ({
            path,
            name: String(document.name ?? document.id ?? path.split("/").pop()),
            kind: workflowKind(document),
            description: typeof document.description === "string" ? document.description : undefined,
            id: shortWorkflowId(String(document.id ?? "")),
            route: workflowRoute(document)?.when,
            edits: workflowMayEdit(document, library),
            switchTo: workflowSwitchTargets(document),
          })),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [rootPath, workflowCatalogVersion]);

  // The followed workflow's document, for the bar's step list. With Auto that
  // is whichever workflow was chosen for the latest message.
  const activeWorkflowPath = chatWorkflow === AUTO_FLOW ? autoWorkflow : chatWorkflow;
  useEffect(() => {
    if (!activeWorkflowPath) {
      setWorkflowDocument(undefined);
      return;
    }
    let cancelled = false;
    behaviorService.readWorkflow(activeWorkflowPath)
      .then((document) => {
        if (cancelled) return;
        setWorkflowDocument(document);
        if (chatWorkflow !== AUTO_FLOW && document.id === STARTER_WORKFLOW.id && chatWorkflow !== BUILTIN_WORKFLOW_PATH) {
          chatWorkflowRef.current = BUILTIN_WORKFLOW_PATH;
          setChatWorkflowState(BUILTIN_WORKFLOW_PATH);
        }
      })
      .catch(() => !cancelled && setWorkflowDocument(undefined));
    return () => {
      cancelled = true;
    };
  }, [activeWorkflowPath, chatWorkflow, workflowCatalogVersion]);

  // Build model options including AUTO if intelligent selection is enabled
  const modelOptions = useCallback(() => {
    if (!intelligentModelSelectionSettings.enabled) return baseModelOptions;
    if (!findOpenRouterJevProvider(customProviders, intelligentModelSelectionSettings.jevModelId)) {
      return baseModelOptions;
    }
    const { missing } = resolveLevelCandidates(
      customProviders,
      providerStatus,
      activeCustomProviderId,
      intelligentModelSelectionSettings.levelModels,
    );
    if (missing.length > 0) return baseModelOptions;
    return [
      { id: AUTO_MODEL_ID, name: "AUTO — Intelligent model selection" },
      ...baseModelOptions,
    ];
  }, [activeCustomProviderId, baseModelOptions, customProviders, intelligentModelSelectionSettings, providerStatus]);

  const modelPlaceholder = baseModelOptions.length === 0 && unauthenticatedProviders.length > 0
    ? `Sign in to ${unauthenticatedProviders.map((p) => p.name).join(", ")} to see more models`
    : "Select model";

  // Seed Agent mode once from the global default, then retain its own choice.
  // A provider refresh must not silently swap it for the first available model.
  useEffect(() => {
    if (savedAgentModelRef.current) return;
    const currentOptions = modelOptions();
    const nextModel = activeModel || currentOptions[0]?.id || "";
    if (!nextModel) return;
    savedAgentModelRef.current = nextModel;
    saveAgentModelSelection(nextModel);
    setSelectedModel(nextModel);
  }, [activeCustomProviderId, activeModel, customProviders, providerStatus, intelligentModelSelectionSettings, modelOptions]);

  useEffect(() => {
    // Always ensure a skill is selected. Resolution order:
    // 1. activeSkillId (if it exists in the list)
    // 2. DEFAULT_SKILL_ID (build)
    // 3. first available skill
    const resolved = resolveSkill(skills, activeSkillId || selectedSkillId);
    const nextId = resolved?.id ?? null;
    if (nextId && selectedSkillId !== nextId) {
      setSelectedSkillId(nextId);
    }
    if (nextId && activeSkillId !== nextId) {
      setActiveSkill(nextId);
    }
  }, [activeSkillId, selectedSkillId, setActiveSkill, skills]);

  useEffect(() => {
    return () => {
      if (consoleFlushTimeoutRef.current) clearTimeout(consoleFlushTimeoutRef.current);
      if (streamingResponseFlushTimeoutRef.current) clearTimeout(streamingResponseFlushTimeoutRef.current);
      if (agentRunRef.current) {
        // command_session_close has no equivalent in the run event stream
        // (it isn't a run event, it's a standing instruction to stop any
        // lingering commands for this tab's session) -- AgentHarness.
        // releaseSession is its backend-agnostic replacement
        // (HARNESS_CONTRACT_PLAN.md Milestone A8).
        void harness.releaseSession(tab.id);
        agentRunRef.current.cancel();
        agentRunRef.current = null;
      }
      // The other half of the sidecar's command_session_close: forget every
      // "allow this session" command grant the user gave this tab (this
      // tab's policy is keepAlive "always", so unmount means closed). Kept
      // outside the run check above -- grants outlive individual runs.
      commandPermissionService.clearSession(tab.id);
    };
  }, [tab.id]);

  // Sync the first subagent ID for detecting new delegations
  // Mirrors isAgentBusy into the store (REFACTOR_PLAN.md PR 7 commit 2) so
  // the `agent` tab policy -- a pure function with no component access --
  // can implement isBusy/beforeClose the same way `canvas`'s already does.
  // Cleared on unmount so a stale `true` can never linger for the next
  // Agent tab (this is a singleton id, reused every time one is reopened).
  useEffect(() => {
    setAgentTabBusy(tab.id, isAgentBusy);
    return () => setAgentTabBusy(tab.id, false);
  }, [tab.id, isAgentBusy, setAgentTabBusy]);

  // ── Chat History ──────────────────────────────────────────────
  useEffect(() => {
    if (previousRootPathRef.current === rootPath) return;
    previousRootPathRef.current = rootPath;
    chatHistoryLoadIdRef.current += 1;

    agentRunRef.current?.cancel();
    agentRunRef.current = null;
    void harness.releaseSession(tab.id);
    commandPermissionService.clearSession(tab.id);
    chatSaveQueueRef.current = new AgentChatSaveQueue();
    setActiveChatPath(null);
    setModifiedFiles([]);
    setChatWorkflow(undefined, { persist: false });
    setFlowSwitching(false, { persist: false });
    setWorkflowCheckpoint(undefined);
    setWorkflowDocument(undefined);
    setWorkflowRunning(false);
    setAutoWorkflow(undefined);
    lastWorkflowRunRef.current = undefined;
    setSubagents([]);
    setRunUsage(null);
    setStreamingLabel("Model is thinking…");
    setAgentQuestions([]);
    isStreamingRef.current = false;
    setIsStreaming(false);
    lastUserMessageIdRef.current = null;
    lastConsoleMessageIdRef.current = null;
    responseStreamRef.current = null;
    for (const resolve of questionResolversRef.current.values()) resolve("");
    questionResolversRef.current.clear();
  }, [rootPath, tab.id]);

  const loadChatHistory = useCallback(async () => {
    const loadId = ++chatHistoryLoadIdRef.current;
    if (!rootPath) {
      setChatHistory([]);
      setLoadingHistory(false);
      return;
    }
    setLoadingHistory(true);
    try {
      const chatsDir = `${rootPath}/.rusty/chats`;
      const tree = await invoke<any[]>("get_directory_structure", { rootDir: chatsDir });
      const chatFiles = (tree || []).filter((f: any) => f.name.endsWith(".json"));

      const loaded: SavedChat[] = [];
      for (const file of chatFiles) {
        try {
          const content = await invoke<string>("read_file_disk", { path: file.path });
          const parsed = JSON.parse(content);
          const messages: AgentMessage[] = parsed.messages || [];
          const firstUser = messages.find((m) => m.role === "user");
          const preview = firstUser
            ? firstUser.content.replace(/@([^\s@]+)/g, "$1").slice(0, 80)
            : "(empty conversation)";
          loaded.push({
            path: file.path,
            name: file.name,
            savedAt: parsed.savedAt || "",
            preview,
            messageCount: messages.length,
            prompts: userPrompts(messages),
          });
        } catch (e) {
          console.error(`Failed to read chat ${file.path}:`, e);
        }
      }
      // Sort newest first
      loaded.sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""));
      if (chatHistoryLoadIdRef.current === loadId) setChatHistory(loaded);
    } catch (e) {
      if (chatHistoryLoadIdRef.current === loadId) setChatHistory([]);
    } finally {
      if (chatHistoryLoadIdRef.current === loadId) setLoadingHistory(false);
    }
  }, [rootPath]);

  useEffect(() => {
    loadChatHistory();
  }, [loadChatHistory]);

  const handleLoadChat = async (chat: SavedChat) => {
    if (isAgentBusy) return;
    try {
      await chatSaveQueueRef.current.flushed().catch(() => {});
      const content = await invoke<string>("read_file_disk", { path: chat.path });
      const parsed = JSON.parse(content);
      const messages: AgentMessage[] = parsed.messages || [];
      setAgentMessages(tab.id, messages);
      setActiveChatPath(chat.path);
      chatSaveQueueRef.current = new AgentChatSaveQueue(chat.path);
      setModifiedFiles(readModifiedFiles(parsed.modifiedFiles));
      setChatWorkflow(readChatWorkflow(parsed.workflow), { persist: false });
      setFlowSwitching(readFlowSwitching(parsed.flowSwitching), { persist: false });
      lastWorkflowRunRef.current = undefined;
      setWorkflowCheckpoint(parsed.workflowCheckpoint);
      setSubagents([]);
    } catch (e) {
      console.error("Failed to load chat:", e);
    }
  };

  const handleNewChat = () => {
    if (isAgentBusy) return;
    clearAgentMessages(tab.id);
    setActiveChatPath(null);
    chatSaveQueueRef.current = new AgentChatSaveQueue();
    setModifiedFiles([]);
    setChatWorkflow(undefined, { persist: false });
    setFlowSwitching(false, { persist: false });
    lastWorkflowRunRef.current = undefined;
    setSubagents([]);
  };

  const handleDeleteChat = async (e: React.MouseEvent, chat: SavedChat) => {
    e.stopPropagation();
    try {
      if (chatSaveQueueRef.current.path === chat.path) {
        await chatSaveQueueRef.current.flushed().catch(() => {});
      }
      await invoke("delete_file_or_dir", { path: chat.path });
      setChatHistory((prev) => prev.filter((c) => c.path !== chat.path));
      if (activeChatPath === chat.path) {
        setActiveChatPath(null);
        chatSaveQueueRef.current = new AgentChatSaveQueue();
      }
    } catch (err) {
      console.error("Failed to delete chat:", err);
    }
  };

  const flushConsoleBuffer = () => {
    if (consoleMessageIdRef.current) {
      updateAgentMessage(tab.id, consoleMessageIdRef.current, consoleBufferRef.current, consoleEntriesRef.current);
    }
  };

  const appendConsoleActivity = (content: unknown, kind: AgentActivityEntry["kind"]) => {
    const text = String(content ?? "");
    if (!text.trim()) return;
    const update = text.endsWith("\n") ? text : `${text}\n`;
    consoleBufferRef.current = appendBoundedText(consoleBufferRef.current, update);
    consoleEntriesRef.current = appendActivityEntry(consoleEntriesRef.current, text, kind);
  };

  const startActivityMessage = () => {
    flushConsoleBuffer();
    const id = `console_${crypto.randomUUID()}`;
    addAgentMessage(tab.id, {
      id,
      role: "console",
      content: "",
      timestamp: new Date().toISOString(),
      phase: "activity",
    });
    consoleMessageIdRef.current = id;
    consoleBufferRef.current = "";
    consoleEntriesRef.current = [];
  };

  const scheduleConsoleFlush = () => {
    if (consoleFlushTimeoutRef.current) return;
    consoleFlushTimeoutRef.current = setTimeout(() => {
      consoleFlushTimeoutRef.current = null;
      flushConsoleBuffer();
    }, 150);
  };

  const flushStreamingResponseBuffer = () => {
    responseStreamRef.current?.flush();
  };

  const scheduleStreamingResponseFlush = () => {
    if (streamingResponseFlushTimeoutRef.current) return;
    streamingResponseFlushTimeoutRef.current = setTimeout(() => {
      streamingResponseFlushTimeoutRef.current = null;
      flushStreamingResponseBuffer();
    }, 100);
  };

  const handleStopExecution = () => {
    agentRunRef.current?.cancel();
    agentRunRef.current = null;

    // Stopping a run must retain the user's request and all visible updates.
    flushConsoleBuffer();
    flushStreamingResponseBuffer();

    // Clear message tracking refs
    lastUserMessageIdRef.current = null;
    lastConsoleMessageIdRef.current = null;
    responseStreamRef.current = null;
    if (streamingResponseFlushTimeoutRef.current) {
      clearTimeout(streamingResponseFlushTimeoutRef.current);
      streamingResponseFlushTimeoutRef.current = null;
    }

    setSubagents((current) => current.map((subagent) =>
      subagent.status === "queued" || subagent.status === "running" || subagent.status === "background"
        ? {
            ...subagent,
            status: "stopped",
            activity: "Stopped by user.",
            logs: [...(subagent.logs || []), "Stopped by user."].slice(-200),
            updatedAt: new Date().toISOString(),
          }
        : subagent
    ));
    isStreamingRef.current = false;
    setIsStreaming(false);
    setStreamingLabel("Model is thinking…");
    setAgentQuestions([]);
    // Anything still waiting on an answer (a run's question, Auto's choice) is released as declined.
    for (const resolve of questionResolversRef.current.values()) resolve("");
    questionResolversRef.current.clear();
    saveChatHistory();
  };

  // Registers this tab's stop callback (REFACTOR_PLAN.md PR 7 commit 2) so
  // the close-intercept controller can generically say "stop whatever this
  // tab is running" without knowing it's an Agent tab specifically. A ref
  // holds the latest `handleStopExecution` closure so the registration
  // itself doesn't need to churn every render.
  const stopExecutionRef = useRef(handleStopExecution);
  stopExecutionRef.current = handleStopExecution;
  useEffect(() => {
    registerTabStop(tab.id, () => stopExecutionRef.current());
    return () => unregisterTabStop(tab.id);
  }, [tab.id]);

  const handleAgentQuestionAnswer = (answer: string) => {
    if (agentQuestions.length === 0) return;
    const currentQuestion = agentQuestions[0];
    questionResolversRef.current.get(currentQuestion.requestId)?.(answer);
    questionResolversRef.current.delete(currentQuestion.requestId);
    appendConsoleActivity(`User answer: ${answer}`, "update");
    flushConsoleBuffer();
    setAgentQuestions((prev) => prev.slice(1));
  };

  const handleSendMessage = async (attachedFiles: { path: string; name: string; isDir?: boolean }[]) => {
    if ((!message.trim() && attachedFiles.length === 0) || isAgentBusy) return;
    const chosenWorkflow = chatWorkflowRef.current;
    // With Auto, Rusty chooses the workflow after the message is in the chat.
    const auto = chosenWorkflow === AUTO_FLOW;
    let followedWorkflow = auto ? undefined : chosenWorkflow;
    // A workflow's steps get their tools from their own profiles, so the
    // chat's skill plays no part in a workflow run (it stays on Build). Auto
    // may still answer with the single agent, which needs one.
    if ((!chosenWorkflow || auto) && !hasSelectedSkill) {
      notify("Skill Required", "Select an Agent Tab skill before sending a prompt.", "error");
      return;
    }

    // The saved file is what runs, read fresh so edits saved in the
    // Behaviors tab since the last message apply.
    let workflowDefinition: Record<string, unknown> | undefined;
    if (followedWorkflow) {
      try {
        workflowDefinition = await behaviorService.readWorkflow(followedWorkflow);
      } catch (error) {
        notify("Workflow unavailable", `Could not read ${followedWorkflow}: ${String(error)}. Choose another in the Mode picker.`, "error");
        return;
      }
    }
    let workflowId = workflowDefinition ? String(workflowDefinition.id ?? "") : "";

    const now = Date.now();
    const attachments = attachedFiles.map((a) => ({ path: a.path, name: a.name, isDir: a.isDir }));
    const attachmentContext = await buildAttachmentContext(attachedFiles);

    const userText = message.trim() || (attachments.length > 0 ? "Inspect the attached context." : "");
    const userMessage: AgentMessage = {
      id: `msg_${now}`,
      role: "user" as const,
      content: userText,
      timestamp: new Date().toISOString(),
      phase: "query",
      attachments,
      attachmentContext: attachmentContext || undefined,
    };

    const consoleMessageId = `msg_${now}_console`;
    const consoleMessage: AgentMessage = {
      id: consoleMessageId,
      role: "console" as const,
      content: "",
      timestamp: new Date().toISOString(),
      phase: "activity",
    };

    lastUserMessageIdRef.current = userMessage.id;
    lastConsoleMessageIdRef.current = consoleMessageId;

    addAgentMessage(tab.id, userMessage);
    addAgentMessage(tab.id, consoleMessage);
    consoleMessageIdRef.current = consoleMessageId;
    consoleBufferRef.current = "";
    consoleEntriesRef.current = [];
    delegatedSubagentIdsRef.current = new Set();
    activeWorkflowAgentStepRef.current = null;
    responseStreamRef.current = new AgentChatResponseStream(
      (message) => addAgentMessage(tab.id, message),
      (id, content) => updateAgentMessage(tab.id, id, content),
      (content) => {
        appendConsoleActivity(content, "update");
        flushConsoleBuffer();
      },
    );
    setSubagents([]);
    setAgentQuestions([]);
    questionResolversRef.current.clear();
    setRunUsage(null);
    saveChatHistory();

    const messageToSend = attachmentContext ? `${userText}\n\n${attachmentContext}` : userText;
    setMessage("");
    isStreamingRef.current = true;
    setIsStreaming(true);
    setStreamingLabel("Model is thinking…");

    if (auto) {
      setStreamingLabel("Choosing a workflow…");
      const routerConfig = snapshotFlowRouter(useWorkspaceStore.getState());
      const candidates: FlowCandidate[] = workflowOptionsRef.current
        .filter((option) => option.route && option.id)
        .map((option) => ({
          id: option.id!,
          name: `${option.kind === "stage" ? "Stage" : "Workflow"}: ${option.name}`,
          criterion: option.route!,
          edits: Boolean(option.edits),
          path: option.path,
        }));
      let choice: FlowChoice = { type: "single" };
      if (!routerConfig) {
        responseStreamRef.current?.progress("↳ AUTO · OpenRouter and a JEV model are needed to choose a workflow; answering directly.");
      } else if (candidates.length > 0) {
        choice = await chooseFlow({
          message: userText,
          // The conversation so far (the new message is already in it), so a follow-up is routed in its setting.
          recentRequests: (useWorkspaceStore.getState().agentChats[tab.id] || [])
            .filter((m: any) => m.role === "user" && m.id !== userMessage.id)
            .map((m: any) => m.content),
          lastResult: priorWorkflowContext(useWorkspaceStore.getState().agentChats[tab.id] || []),
          lastRun: lastWorkflowRunRef.current,
          candidates,
          router: {
            ...routerConfig,
            onTrace: (trace) => executionObservability.recordStandalone(
              jevFlowRecord(trace, { tabId: tab.id, workspaceRoot: useWorkspaceStore.getState().rootPath || undefined }),
            ),
          },
          announce: (line) => responseStreamRef.current?.progress(line),
        });
      }
      if (!isStreamingRef.current) return; // stopped while choosing
      if (choice.type === "workflow") {
        try {
          workflowDefinition = await behaviorService.readWorkflow(choice.candidate.path);
          followedWorkflow = choice.candidate.path;
        } catch (error) {
          notify("Workflow unavailable", `Could not read ${choice.candidate.path}: ${String(error)}. Answering directly.`, "error");
        }
      }
      setAutoWorkflow(followedWorkflow);
      workflowId = workflowDefinition ? String(workflowDefinition.id ?? "") : "";
      // A failed run resumes only on the workflow it belongs to.
      if (workflowCheckpointRef.current && workflowCheckpointRef.current.definition_id !== workflowId) setWorkflowCheckpoint(undefined);
      setStreamingLabel("Model is thinking…");
    }

    /** Starts one run for the message: a single agent, or a workflow. A
     * workflow that hands over ends with `switchTo`, and the next run starts
     * from here in the same turn. */
    const launch = async (plan: LaunchPlan): Promise<void> => {
      const { workflowDefinition, workflowId } = plan;
      const wsRootPath = useWorkspaceStore.getState().rootPath;
      const currentProviders = useWorkspaceStore.getState().customProviders;
      const currentActiveProviderId = useWorkspaceStore.getState().activeCustomProviderId;
      const currentProviderStatus = useWorkspaceStore.getState().providerStatus;

      // Resolve AUTO to a concrete model before execution
      let concreteModelId = selectedModel;
      // With AUTO, JEV decisions can later step the run up to a higher level's model.
      let autoStepUp: DecideStepUpConfig | undefined;
      // With AUTO on a workflow, each agent step picks its own model (see
      // stepModelSelection.ts) instead of the whole message being rated once.
      let autoStepModels: ReturnType<typeof snapshotStepModels>;
      if (selectedModel === AUTO_MODEL_ID) {
        setStreamingLabel("Selecting the best model…");
        const jevProvider = findOpenRouterJevProvider(currentProviders, intelligentModelSelectionSettings.jevModelId);
        if (!jevProvider) {
          addAgentMessage(tab.id, {
            id: `msg_${Date.now()}`,
            role: "assistant" as const,
            content: "OpenRouter JEV provider not available for intelligent model selection.",
            timestamp: new Date().toISOString(),
          });
          isStreamingRef.current = false;
          setIsStreaming(false);
          notify("Model Selection Failed", "OpenRouter provider is not configured.", "error");
          return;
        }

        const { candidates, missing } = resolveLevelCandidates(
          currentProviders,
          currentProviderStatus,
          currentActiveProviderId,
          intelligentModelSelectionSettings.levelModels,
        );
        try {
          if (missing.length > 0) {
            throw new IntelligentModelSelectionError(
              `No available model is set for ${missing.map((level) => AUTO_LEVEL_LABELS[level]).join(", ")}. Choose one in Settings → Intelligence.`,
            );
          }
          const levelCandidates = candidates as LevelCandidates;
          const levels = Object.fromEntries(Object.entries(levelCandidates).map(([level, candidate]) => [
            level,
            { providerId: candidate.provider.id, model: candidate.model.id, name: candidate.model.name },
          ]));
          if (workflowDefinition) {
            // Steps start on the Standard level's model and move to the level
            // JEV rates them at, just before their first model turn.
            concreteModelId = levelCandidates.standard.model.id;
            autoStepUp = { level: "standard", levels };
            autoStepModels = snapshotStepModels(useWorkspaceStore.getState(), levels);
            if (!autoStepModels) throw new IntelligentModelSelectionError("OpenRouter JEV is not available for choosing each step's model.");
            setStreamingLabel("Choosing a model for each step…");
          } else {
            const selection = await selectIntelligentModel(
              messageToSend,
              jevProvider,
              levelCandidates,
              intelligentModelSelectionSettings.jevModelId,
              (trace) => executionObservability.recordStandalone(
                jevSelectionRecord(trace, { tabId: tab.id, workspaceRoot: wsRootPath || undefined }),
              ),
            );
            concreteModelId = selection.candidate.model.id;
            autoStepUp = { level: selection.level, levels };
            const confidence = (selection.confidence * 100).toFixed(0);
            setStreamingLabel(`${AUTO_LEVEL_LABELS[selection.level]} task${selection.escalated ? " (stepped up)" : ""} · ${selection.candidate.model.name} (${confidence}% confidence)…`);
          }
        } catch (error) {
          const errorMessage = error instanceof IntelligentModelSelectionError
            ? error.message
            : "An unexpected error occurred during model selection.";
          addAgentMessage(tab.id, {
            id: `msg_${Date.now()}`,
            role: "assistant" as const,
            content: `Model selection error: ${errorMessage}\n\nPlease select a model manually.`,
            timestamp: new Date().toISOString(),
          });
          isStreamingRef.current = false;
          setIsStreaming(false);
          notify("Model Selection Failed", errorMessage, "error");
          return;
        }
      }

      const resolution = resolveExecutionProvider(
        currentProviders,
        currentProviderStatus,
        currentActiveProviderId,
        concreteModelId,
      );
      if (!resolution.ok) {
        addAgentMessage(tab.id, {
          id: `msg_${Date.now()}`,
          role: "assistant" as const,
          content: resolution.message,
          timestamp: new Date().toISOString(),
        });
        isStreamingRef.current = false;
        setIsStreaming(false);
        notify("Cannot send message", resolution.message, "error");
        return;
      }
      const prov = resolution.provider;
      const chatHistory = useWorkspaceStore.getState().agentChats[tab.id] || [];
      const currentSkills = useWorkspaceStore.getState().skills;
      const resolved = resolveSkill(currentSkills, workflowDefinition ? BUILT_IN_SKILL_IDS.BUILD : selectedSkillId);
      const skillData = toSkillData(resolved);

      // Offer every connected server; the session's execution policy decides
      // which ones the active skill actually gets (skillExecutionPolicy.ts).
      const mcpServers = Object.values(useWorkspaceStore.getState().mcpServers).filter((server) => server.enabled);

      const host = createRunHost({
        readFile: (path) => invoke<string>("read_file_disk", { path }),
        writeFile: async (path, content) => {
          await invoke("write_file_disk", { path, content });
        },
        askQuestion: (question) =>
          new Promise<string>((resolve) => {
            questionResolversRef.current.set(question.requestId, resolve);
            setAgentQuestions((prev) => {
              if (prev.some((q) => q.requestId === question.requestId)) return prev;
              return [...prev, question];
            });
          }),
      });
      // While a workflow runs, the status line names its current step.
      let workflowStep: string | undefined;
      const setRunLabel = (label: string) => setStreamingLabel(workflowStep ? `${workflowStep} · ${label}` : label);
      const workflowStepTypes: Record<string, string> = Object.fromEntries(
        (Array.isArray(workflowDefinition?.nodes) ? (workflowDefinition.nodes as Array<{ id?: unknown; type?: unknown }>) : [])
          .map((node) => [String(node.id), String(node.type)]),
      );
      // Whether this run may hand over to another workflow at a step boundary, and to which.
      const flowSwitchingConfig = (() => {
        if (!flowSwitchingRef.current || !workflowDefinition || plan.switchesLeft <= 0) return undefined;
        const router = snapshotFlowRouter(useWorkspaceStore.getState());
        if (!router) return undefined;
        const targets = workflowSwitchTargets(workflowDefinition as JsonObject)
          .map((id) => workflowOptionsRef.current.find((option) => option.id === id))
          .filter((option): option is WorkflowChoice & { id: string } => Boolean(option?.id) && !plan.visited.includes(option!.id!))
          .map((option) => ({
            id: option.id,
            path: option.path,
            name: `${option.kind === "stage" ? "Stage" : "Workflow"}: ${option.name}`,
            when: option.route ?? option.description ?? option.name,
            edits: Boolean(option.edits),
          }));
        return targets.length > 0 ? { router, workflowName: String(workflowDefinition.name ?? workflowId), targets } : undefined;
      })();
      // Every file this run changed, whichever tool changed it: a run that
      // changed none leaves its Result behind as a Markdown report.
      const changedThisRun = new Set<string>();
      const run = harness.run(
        "agent_chat",
        {
          tabId: tab.id,
          message: messageToSend,
          model: concreteModelId,
          workspaceRoot: wsRootPath,
          chatHistory: chatHistory
            .filter((m: any) => m.id !== userMessage.id && (m.role === "user" || m.role === "assistant"))
            .map((m: any) => ({
              role: m.role,
              content:
                m.role === "user" && m.attachmentContext
                  ? `${m.content}\n\n${m.attachmentContext}`
                  : m.content,
            })),
          customProvider: prov,
          skill: skillData,
          skillId: skillData?.skillId,
          mcpServers,
          webSearchApiKeys: useWorkspaceStore.getState().webSearchApiKeys,
          planOnly: false,
          vfsOnly: false,
          lspSettings: { ...useWorkspaceStore.getState().lspSettings, enabled: false },
          smartToolSettings: snapshotSmartToolSettings(useWorkspaceStore.getState()),
          jevDecisionTool: snapshotJevDecisionTool(useWorkspaceStore.getState(), autoStepUp),
          jevRiskReview: snapshotJevRiskReview(useWorkspaceStore.getState()),
          ...(autoStepModels ? { autoStepModels } : {}),
          ...(flowSwitchingConfig ? { flowSwitching: flowSwitchingConfig } : {}),
          workflow: workflowDefinition ? {
            definition: workflowDefinition,
            // A stage picks up the result the previous run left in this chat, or
            // the work a workflow finished before it handed over.
            // A workflow that reads `/context` is given the earlier result there. One
            // that only reads the request would otherwise see a bare follow-up and
            // start from nothing, so the conversation goes behind its request.
            input: workflowUsesContext(workflowDefinition)
              ? workflowInputFor(messageToSend, Boolean(workflowDefinition.input_schema), plan.context ?? conversationResults(chatHistory), chatHistory)
              : workflowInputFor(
                workflowDefinition.input_schema
                  ? messageToSend
                  : withConversation(messageToSend, chatHistory.filter((m: any) => m.id !== userMessage.id), plan.context),
                Boolean(workflowDefinition.input_schema),
              ),
            checkpoint: workflowCheckpointRef.current,
          } : undefined,
        },
        host,
        (event) => {
          // Any host event is a sign of life for the workflow's "no activity" notice.
          useWorkflowRunStore.getState().touchRunning();
          switch (event.kind) {
            case "command_output":
              appendConsoleActivity(event.content, "tool");
              scheduleConsoleFlush();
              break;
            case "command_complete":
              scheduleTreeRefresh();
              break;
            case "files_changed":
              event.paths.forEach((changed) => changedThisRun.add(changed));
              setModifiedFiles([...modifiedFilesRef.current, ...event.paths]);
              scheduleTreeRefresh();
              break;
            case "log": {
              appendConsoleActivity(event.message, "tool");
              scheduleConsoleFlush();
              if (event.message.startsWith("Calling ")) {
                setRunLabel(event.message.replace(/\.\.\.$/, "…"));
              } else if (event.message.includes("completed") || event.message.includes("failed")) {
                setRunLabel("Processing results…");
              }
              break;
            }
            case "usage":
              setRunUsage(event.usage);
              break;
            case "token": {
              setRunLabel("Generating response…");
              responseStreamRef.current?.append(event.content, event.messageId);
              scheduleStreamingResponseFlush();
              break;
            }
            case "progress": {
              appendConsoleActivity(event.content, "update");
              flushConsoleBuffer();
              break;
            }
            case "workflow_checkpoint":
              setWorkflowCheckpoint(event.state);
              break;
            case "workflow_boundary":
              if (event.status === "checking") setRunLabel("Checking whether to switch flows…");
              break;
            case "workflow_step": {
              useWorkflowRunStore.getState().step(event.workflowId, event);
              const name = event.name ?? event.nodeId;
              const attempt = event.attempt > 1 ? ` (attempt ${event.attempt})` : "";
              if (event.status === "running") {
                workflowStep = `${name}${attempt}`;
                setRunLabel("Working…");
                // Each agent workflow step owns its own activity and response pair.
                if (workflowStepTypes[event.nodeId] === "agent") {
                  const stepKey = `${event.workflowId}:${event.nodeId}:${event.attempt}`;
                  if (activeWorkflowAgentStepRef.current && activeWorkflowAgentStepRef.current !== stepKey) {
                    responseStreamRef.current?.startSegment();
                    startActivityMessage();
                    delegatedSubagentIdsRef.current = new Set();
                    setSubagents([]);
                  }
                  activeWorkflowAgentStepRef.current = stepKey;
                  const update = `▶ ${name}${attempt}`;
                  appendConsoleActivity(update, "update");
                  flushConsoleBuffer();
                }
              } else if (event.status === "waiting") {
                setRunLabel("Waiting for your permission…");
              } else if (event.status === "failed") {
                const update = `✗ ${name} failed${event.message ? `: ${event.message}` : ""}`;
                appendConsoleActivity(update, "update");
                flushConsoleBuffer();
              }
              break;
            }
            case "subagent": {
              const subagent = event.subagent;
              if (!(subagent as any)?.id) break;
              const incoming = {
                ...(subagent as any),
                updatedAt: (subagent as any).updatedAt || new Date().toISOString(),
              } as SubagentActivity & { previousId?: string; appendLog?: string; logs?: string[] };
              // Start a new activity card once per newly delegated subagent.
              // Subsequent events for that subagent stay in its current card.
              if (!delegatedSubagentIdsRef.current.has(incoming.id)) {
                if (delegatedSubagentIdsRef.current.size > 0) {
                  startActivityMessage();
                }
                delegatedSubagentIdsRef.current.add(incoming.id);
              }
              setSubagents((prev) => {
                const index = prev.findIndex((item) =>
                  item.id === incoming.id || (!!incoming.previousId && item.id === incoming.previousId)
                );
                const incomingLogs = [
                  ...(Array.isArray(incoming.logs) ? incoming.logs : []),
                  ...(incoming.appendLog ? [incoming.appendLog] : []),
                ];
                const cleanIncoming = { ...incoming };
                delete cleanIncoming.appendLog;
                delete cleanIncoming.previousId;
                if (index === -1) {
                  return [...prev, { ...cleanIncoming, logs: incomingLogs }];
                }
                const next = [...prev];
                const currentLogs = next[index].logs || [];
                const mergedLogs = [...currentLogs];
                for (const log of incomingLogs) {
                  if (log && mergedLogs[mergedLogs.length - 1] !== log) mergedLogs.push(log);
                }
                next[index] = { ...next[index], ...cleanIncoming, id: incoming.id, logs: mergedLogs.slice(-200) };
                return next;
              });
              break;
            }
          }
        },
        { surface: "agent-tab", tabId: tab.id, displayLabel: tab.title || "Agent" },
      );
      if (workflowId) {
        useWorkflowRunStore.getState().begin(workflowId);
        const steps = workflowCheckpointRef.current?.steps as Record<string, { status?: string; attempts?: unknown[] }> | undefined;
        for (const [nodeId, step] of Object.entries(steps ?? {})) {
          if (step.status === "succeeded") useWorkflowRunStore.getState().step(workflowId, {
            nodeId, status: "succeeded", attempt: step.attempts?.length ?? 1,
          });
        }
        setWorkflowRunning(true);
        void run.done.then((outcome) => {
          setWorkflowRunning(false);
          lastWorkflowRunRef.current = {
            name: String(workflowDefinition?.name ?? workflowId),
            status: outcome.status === "completed" ? "completed" : outcome.status === "failed" ? "failed" : "was cancelled",
          };
          const review = outcome.status === "failed" && workflowDefinition && failedVerificationReport(workflowDefinition, workflowCheckpointRef.current);
          useWorkflowRunStore.getState().finish(workflowId, outcome.status, outcome.status === "failed" ? (review ? "Verification incomplete; see the review in chat." : outcome.error.message) : undefined);
        });
      }
      if (!workflowId) lastWorkflowRunRef.current = undefined;
      void run.done.then(async (outcome) => {
        if (outcome.status === "completed") {
          const { response, modifiedFiles: files, subagents: completedSubagents } = outcome.result;
          if (consoleFlushTimeoutRef.current) {
            clearTimeout(consoleFlushTimeoutRef.current);
            consoleFlushTimeoutRef.current = null;
          }
          flushConsoleBuffer();
          if (streamingResponseFlushTimeoutRef.current) {
            clearTimeout(streamingResponseFlushTimeoutRef.current);
            streamingResponseFlushTimeoutRef.current = null;
          }
          setModifiedFiles([...modifiedFilesRef.current, ...files]);
          files.forEach((filePath) => {
            const path = filePath.startsWith("/") || !rootPath
              ? filePath
              : `${rootPath.replace(/[\\\/]$/, "")}/${filePath.replace(/^\.\//, "")}`;
            const fileName = path.split(/[\\\/]/).pop() || path;
            openTab({ type: "file", path, title: fileName });
          });
          // Refresh after opening the returned files.  The agent may have
          // created them during the run, so the explorer must observe the
          // completed writes rather than only the command-output refresh.
          if (files.length > 0 && rootPath) {
            await refreshTree();
          }

          // A workflow that only looked leaves its Result in a file to pick up
          // later; one that changed files does not (the changes are the outcome).
          // A run that handed over saves nothing: the next run continues from its
          // work, which is already in the conversation.
          let savedNote = "";
          const report = workflowId && wsRootPath && !outcome.result.switchTo
            ? workflowReportFor({
              workflowName: String(workflowDefinition?.name ?? workflowId),
              request: userText,
              text: response,
              changedFiles: [...changedThisRun, ...files],
            })
            : undefined;
          if (report && wsRootPath) {
            try {
              await invoke("write_file_disk", { path: `${wsRootPath.replace(/[\\/]$/, "")}/${report.path}`, content: report.content });
              savedNote = `\n\n_Result saved to \`${report.path}\`_`;
              await refreshTree();
            } catch (error) {
              savedNote = `\n\n_The result could not be saved to \`${report.path}\`: ${String(error)}_`;
            }
          }

          const finalResponse = (response || "Agent complete.") + savedNote;
          if (completedSubagents.length > 0) {
            // The completed response can contain each subagent's full result.
            // Keep the panel focused on status and its last few activity lines.
            setSubagents((completedSubagents as SubagentActivity[]).map((subagent) => ({
              ...subagent,
              logs: (subagent.logs || []).slice(-4),
            })));
          }
          // The run handed over: the same turn goes on in the workflow it chose.
          const switchTo = outcome.result.switchTo;
          if (switchTo && plan.switchesLeft > 0 && isStreamingRef.current) {
            responseStreamRef.current?.finish(finalResponse);
            responseStreamRef.current = new AgentChatResponseStream(
              (added) => addAgentMessage(tab.id, added),
              (id, content) => updateAgentMessage(tab.id, id, content),
              (content) => {
                const update = content.endsWith("\n") ? content : `${content}\n`;
                consoleBufferRef.current = appendBoundedText(consoleBufferRef.current, update);
                flushConsoleBuffer();
              },
            );
            agentRunRef.current = null;
            setStreamingLabel(`Starting ${switchTo.name}…`);
            try {
              const nextDefinition = await behaviorService.readWorkflow(switchTo.path);
              if (isStreamingRef.current) {
                // A chat that follows one workflow now follows the one it handed over to; Auto keeps choosing per message.
                if (chatWorkflowRef.current === AUTO_FLOW) setAutoWorkflow(switchTo.path);
                else setChatWorkflow(switchTo.path);
                await launch({
                  workflowDefinition: nextDefinition,
                  workflowId: String(nextDefinition.id ?? ""),
                  context: switchTo.context,
                  switchesLeft: plan.switchesLeft - 1,
                  visited: [...plan.visited, switchTo.id],
                });
                return;
              }
            } catch (error) {
              notify("Could not hand over", `Could not read ${switchTo.path}: ${String(error)}. The turn ends here.`, "error");
            }
          }
          isStreamingRef.current = false;
          lastUserMessageIdRef.current = null;
          lastConsoleMessageIdRef.current = null;
          responseStreamRef.current?.finish(finalResponse);
          responseStreamRef.current = null;
          setIsStreaming(false);
          setStreamingLabel("Model is thinking…");
          setAgentQuestions([]);
          questionResolversRef.current.clear();
          agentRunRef.current = null;
          saveChatHistory();
          return;
        }

        if (outcome.status === "failed") {
          const message = outcome.error.message;
          const review = workflowDefinition && failedVerificationReport(workflowDefinition, workflowCheckpointRef.current);
          appendConsoleActivity(review ? "Verification incomplete; see the review in chat." : `Error: ${message}`, "update");
          if (consoleFlushTimeoutRef.current) clearTimeout(consoleFlushTimeoutRef.current);
          consoleFlushTimeoutRef.current = null;
          flushConsoleBuffer();
          if (streamingResponseFlushTimeoutRef.current) {
            clearTimeout(streamingResponseFlushTimeoutRef.current);
            streamingResponseFlushTimeoutRef.current = null;
          }
          flushStreamingResponseBuffer();
          addAgentMessage(tab.id, {
            id: `msg_${Date.now()}`,
            role: "assistant" as const,
            content: review ?? `Error: ${message}`,
            timestamp: new Date().toISOString(),
          });
          isStreamingRef.current = false;
          lastUserMessageIdRef.current = null;
          lastConsoleMessageIdRef.current = null;
          responseStreamRef.current = null;
          setIsStreaming(false);
          setStreamingLabel("Model is thinking…");
          setAgentQuestions([]);
          questionResolversRef.current.clear();
          agentRunRef.current = null;
          if (review) notify("Verification incomplete", "The workflow finished with unresolved findings. See the review in chat.", "error");
          else notify("Agent Error", `The agent encountered an error: ${message}`, "error");
          saveChatHistory();
        }
      });
      agentRunRef.current = run;
    };

    await launch({
      workflowDefinition,
      workflowId,
      switchesLeft: MAX_FLOW_SWITCHES_PER_MESSAGE,
      visited: workflowDefinition ? [shortWorkflowId(workflowId)] : [],
    });
  };

  const handleOpenModifiedFile = (filePath: string) => {
    const fileName = filePath.split(/[\\\/]/).pop() || filePath;
    openTab({ type: "file", path: filePath, title: fileName });
  };

  const saveChatHistory = async () => {
    if (!rootPath) return;
    // Snapshot synchronously: closing the tab removes its messages from
    // the store, and a later render may belong to a different conversation.
    const messages = useWorkspaceStore.getState().agentChats[tab.id] || [];
    const queue = chatSaveQueueRef.current;
    try {
      await queue.save(rootPath, tab.id, messages, modifiedFilesRef.current, chatWorkflowRef.current, workflowCheckpointRef.current, flowSwitchingRef.current);
      if (chatSaveQueueRef.current === queue) setActiveChatPath(queue.path);
      await loadChatHistory();
    } catch (error) {
      console.error("Failed to save chat history:", error);
      notify("Chat not saved", "Could not save this conversation. Please check workspace access.", "error");
    }
  };

  /** Which workflow this chat follows. A conversation already on disk
   * remembers the choice right away; a new one saves it with its first
   * message. */
  const setChatWorkflow = (path: string | undefined, { persist = true }: { persist?: boolean } = {}) => {
    setWorkflowCheckpoint(undefined);
    chatWorkflowRef.current = path;
    setChatWorkflowState(path);
    setAutoWorkflow(undefined);
    if (persist && (useWorkspaceStore.getState().agentChats[tab.id] || []).length > 0) void saveChatHistory();
  };

  const setFlowSwitching = (allowed: boolean, { persist = true }: { persist?: boolean } = {}) => {
    flowSwitchingRef.current = allowed;
    setFlowSwitchingState(allowed);
    if (persist && (useWorkspaceStore.getState().agentChats[tab.id] || []).length > 0) void saveChatHistory();
  };

  // "Run in Agent Mode" from the Behaviors tab: follow that workflow in a
  // fresh chat (or this one, when it is still empty).
  useEffect(() => {
    if (!agentWorkflowRequest || isAgentBusy) return;
    const path = useWorkflowRunStore.getState().takeAgentRequest();
    if (!path) return;
    if ((useWorkspaceStore.getState().agentChats[tab.id] || []).length > 0) handleNewChat();
    setChatWorkflow(path, { persist: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentWorkflowRequest, isAgentBusy]);

  // With Auto the skill is locked only while the workflow it chose is running; between messages it may still answer directly.
  const skillLocked = chatWorkflow === AUTO_FLOW ? Boolean(autoWorkflow) && workflowRunning : Boolean(chatWorkflow);
  const availableModelOptions = modelOptions();
  const currentModelOptions = selectedModel && !availableModelOptions.some((option) => option.id === selectedModel)
    ? [...availableModelOptions, { id: selectedModel, name: `${selectedModel} (unavailable)` }]
    : availableModelOptions;

  return (
    <div className="w-full h-full flex bg-[var(--bg-app)] text-[var(--text-normal)] font-mono relative terminal-theme-tab">
      {/* Chat History Sidebar */}
      {showHistory && (
        <div className="w-64 flex-shrink-0 border-r border-[var(--border-color)] bg-[var(--bg-sidebar)]/40 flex flex-col h-full overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] flex-shrink-0">
            <div className="flex items-center space-x-1.5 text-[var(--text-muted)]">
              <History size={13} />
              <span className="text-[10px] font-mono uppercase tracking-wider font-bold">Chats</span>
              <span className="text-[9px] font-mono text-[var(--text-muted)]">({chatHistory.length})</span>
            </div>
            <div className="flex items-center space-x-1">
              <button
                onClick={loadChatHistory}
                disabled={loadingHistory}
                className="p-1 rounded hover:bg-[var(--accent-bg)] text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors cursor-pointer border-none bg-transparent"
                title="Refresh"
              >
                <RefreshCw size={11} className={loadingHistory ? "animate-spin" : ""} />
              </button>
              <button
                onClick={handleNewChat}
                disabled={isAgentBusy}
                className="p-1 rounded hover:bg-[var(--accent-bg)] text-[var(--text-muted)] hover:text-[var(--text-color)] transition-colors cursor-pointer disabled:opacity-40 border-none bg-transparent"
                title="New chat"
              >
                <Plus size={12} />
              </button>
              <button
                onClick={() => setShowHistory(false)}
                className="p-1 rounded hover:bg-[var(--accent-bg)] text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors cursor-pointer border-none bg-transparent"
                title="Hide history"
              >
                <PanelLeftClose size={12} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            {chatHistory.length === 0 ? (
              <div className="px-3 py-6 text-center text-[10px] font-mono text-[var(--text-muted)] leading-relaxed">
                {loadingHistory ? "Loading..." : "No saved chats yet.\nStart a conversation to see it here."}
              </div>
            ) : (
              chatHistory.map((chat) => {
                const isActive = activeChatPath === chat.path;
                const date = chat.savedAt ? new Date(chat.savedAt) : null;
                const dateLabel = date
                  ? date.toLocaleDateString() === new Date().toLocaleDateString()
                    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                    : date.toLocaleDateString([], { month: "short", day: "numeric" })
                  : "";
                return (
                  <div
                    key={chat.path}
                    onClick={() => handleLoadChat(chat)}
                    className={`group mx-1.5 my-0.5 px-2.5 py-2 rounded-lg cursor-pointer transition-all border ${
                      isActive
                        ? "border-[var(--accent-color)] bg-[var(--accent-bg)]/30"
                        : "border-transparent hover:bg-[var(--bg-app)]/50 hover:border-[var(--border-color)]"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[9px] font-mono text-[var(--text-muted)]">{dateLabel}</span>
                      <div className="flex items-center space-x-1">
                        <span className="text-[8px] font-mono text-[var(--text-muted)]">{chat.messageCount} msgs</span>
                        <button
                          onClick={(e) => handleDeleteChat(e, chat)}
                          className="opacity-0 group-hover:opacity-100 text-[var(--color-status-danger)] hover:text-[var(--color-status-danger)] transition-all p-0.5 border-none bg-transparent cursor-pointer"
                          title="Delete chat"
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                    </div>
                    <p className={`text-[11px] font-mono leading-snug line-clamp-2 ${isActive ? "text-[var(--text-light)]" : "text-[var(--text-normal)]"}`}>
                      {chat.preview}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Main chat column */}
      <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/50 flex-shrink-0">
          <div className="flex items-center space-x-3">
            {!showHistory && (
              <button
                onClick={() => setShowHistory(true)}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-light)] hover:bg-[var(--accent-bg)] transition-colors cursor-pointer border-none bg-transparent"
                title="Show chat history"
              >
                <PanelLeft size={16} />
              </button>
            )}
            <CustomSelect
              value={selectedModel}
              onChange={(model) => {
                savedAgentModelRef.current = model;
                saveAgentModelSelection(model);
                setSelectedModel(model);
                // AUTO is an Agent-only choice; concrete choices also update the shared default.
                if (model !== AUTO_MODEL_ID) {
                  setActiveModel(model);
                }
              }}
              options={currentModelOptions}
              placeholder={modelPlaceholder}
              className="w-64"
            />
            {/* Workflow steps get their tools from their own profiles, so a followed
                workflow keeps the skill on Build (the full tool set) and the picker inert. */}
            <div
              className="flex items-center space-x-2"
              title={skillLocked ? "While a workflow is followed, each step's profile decides its tools, so the skill stays on Build." : undefined}
            >
              <CustomSelect
                value={skillLocked ? BUILT_IN_SKILL_IDS.BUILD : selectedSkillId || DEFAULT_SKILL_ID}
                onChange={(val) => {
                  if (!val) return;
                  setSelectedSkillId(val);
                  setActiveSkill(val);
                }}
                options={skills.filter(s => !s.isInternal).map(s => ({ id: s.id, name: s.name }))}
                placeholder="Select skill"
                className="w-48"
                disabled={skillLocked}
              />
              {skillLocked ? (
                <span className="text-[10px] font-mono text-[var(--text-muted)] whitespace-nowrap">tools set per step</span>
              ) : null}
            </div>
            {modifiedFiles.length > 0 && (
              <span className="flex items-center space-x-1.5 px-2.5 py-1 bg-[var(--color-status-success-bg)] border border-[var(--color-status-success-border)] rounded-lg text-[10px] font-mono text-[var(--color-status-success)]">
                <CheckCircle2 size={11} />
                <span>{modifiedFiles.length} file{modifiedFiles.length !== 1 ? "s" : ""} modified</span>
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2 text-[var(--text-muted)] font-mono text-[10px]">
            <label htmlFor="agent-chat-search" className="sr-only">Search chat messages</label>
            <input
              id="agent-chat-search"
              value={chatSearch}
              onChange={(event) => setChatSearch(event.target.value)}
              placeholder="Search chat"
              className="w-40 rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-app)] px-2 py-1 text-xs text-[var(--color-fg-default)]"
            />
            <button
              type="button"
              id="agent-chat-search-previous"
              aria-label="Previous chat match"
              title="Previous chat match"
              disabled={!chatSearch.trim() || searchMatches.length === 0}
              onClick={() => {
                const next = searchMatches.length ? (activeSearchIndex - 1 + searchMatches.length) % searchMatches.length : 0;
                setActiveSearchIndex(next);
                if (searchMatches[next]) navigateToMessage(searchMatches[next].messageId);
              }}
            >Prev</button>
            <button
              type="button"
              id="agent-chat-search-next"
              aria-label="Next chat match"
              title="Next chat match"
              disabled={!chatSearch.trim() || searchMatches.length === 0}
              onClick={() => {
                const next = searchMatches.length ? (activeSearchIndex + 1) % searchMatches.length : 0;
                setActiveSearchIndex(next);
                if (searchMatches[next]) navigateToMessage(searchMatches[next].messageId);
              }}
            >Next</button>
            <span id="agent-chat-search-status" aria-live="polite">
              {searchMatches.length} {searchMatches.length === 1 ? "match" : "matches"}
            </span>
            {runUsage && <TokenBadge usage={runUsage} live={isStreaming} />}
            {isAgentBusy && <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-color)] animate-ping" />}
            <span>{isStreaming ? "Thinking" : hasActiveSubagents ? "Subagents working" : "Ready"}</span>
          </div>
        </div>

        {/* Modified files bar */}
        {modifiedFiles.length > 0 && (
          <div className="flex items-center space-x-2 px-4 py-1.5 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/30 flex-shrink-0 overflow-x-auto">
            <FolderGit2 size={12} className="text-[var(--color-status-success)] flex-shrink-0" />
            <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-wider flex-shrink-0">Changes:</span>
            {modifiedFiles.map((filePath) => {
              const fileName = filePath.split("/").pop() || filePath;
              return (
                <button
                  key={filePath}
                  onClick={() => handleOpenModifiedFile(filePath)}
                  className="flex items-center space-x-1 px-2 py-0.5 bg-[var(--color-surface-app)] border border-[var(--color-border-default)] hover:border-[var(--color-status-success)] rounded text-[10px] font-mono text-[var(--color-fg-strong)] cursor-pointer transition-colors flex-shrink-0"
                >
                  <FileText size={10} className="text-[var(--color-status-success)]" />
                  <span>{fileName}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Chat List and input block */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden max-w-6xl mx-auto w-full">
          <div className="flex flex-1 min-h-0 min-w-0">
            <ChatQueryRail queries={queryMetadata} activeQueryId={activeQueryId} onSelect={selectQuery} disabled={agentChats.length === 0} />
            <Chat
              messages={agentChats}
              isStreaming={isAgentBusy}
              streamingMessageId={consoleMessageIdRef.current}
              streamingLabel={streamingLabel}
              subagents={subagents}
              followLatest
              explicitScrollTarget={scrollTarget}
              onScrollTargetHandled={(messageId) => {
                setScrollTarget((current) => current?.messageId === messageId ? undefined : current);
              }}
              activeMessageId={activeSearchMatch?.messageId || activeQueryId}
              searchMatches={searchMatches}
              activeSearchMatch={activeSearchMatch}
            />
          </div>
          
          <div className="px-3 py-2 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-header)] flex-shrink-0 w-full">
            <AgentWorkflowBar
              workflows={workflowOptions}
              selected={chatWorkflow}
              definition={workflowDocument}
              run={workflowDocument ? workflowRuns[String(workflowDocument.id ?? "")] : undefined}
              running={workflowRunning}
              disabled={isAgentBusy}
              autoAvailable={Boolean(findOpenRouterJevProvider(customProviders, intelligentModelSelectionSettings.jevModelId))}
              flowSwitching={flowSwitching}
              onFlowSwitchingChange={(allowed) => setFlowSwitching(allowed)}
              onStop={handleStopExecution}
              onSelect={(path) => {
                setChatWorkflow(path);
              }}
            />
            {workflowCheckpoint && !isAgentBusy && chatWorkflow !== AUTO_FLOW && (
              <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-text-secondary)] py-2">
                <span>Your next message resumes the workflow with the findings above. Completed steps are retained.</span>
                <button type="button" className="underline" onClick={() => { setWorkflowCheckpoint(undefined); void saveChatHistory(); }}>Start over instead</button>
              </div>
            )}
            <ChatInput
              value={message}
              onChange={setMessage}
              onSend={handleSendMessage}
              disabled={isAgentBusy || (!hasSelectedSkill && (!chatWorkflow || chatWorkflow === AUTO_FLOW))}
              isStreaming={isAgentBusy}
              onStop={handleStopExecution}
              agentQuestion={agentQuestion}
              onAgentQuestionAnswer={handleAgentQuestionAnswer}
              promptHistory={promptHistory}
              placeholder="Message agent... (type @ to reference files) or press ↑ to display last prompts"
            />
          </div>
        </div>

      </div>
    </div>
  );
};
