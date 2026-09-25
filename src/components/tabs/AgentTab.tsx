import React, { useState, useEffect, useRef, useCallback } from "react";
import { History, Trash2, Plus, RefreshCw, PanelLeftClose, PanelLeft, CheckCircle2, FolderGit2, FileText } from "lucide-react";
import { useWorkspaceStore, AgentMessage } from "../../store";
import { resolveSkill, toSkillData, DEFAULT_SKILL_ID } from "../../config/skillDefinitions";
import { CustomSelect } from "../CustomSelect";
import { invoke } from "@tauri-apps/api/core";
import { Chat, SubagentActivity } from "../ui/Chat";
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
import { AgentChatSaveQueue, readModifiedFiles } from "../../services/agentChatPersistence";
import { AgentChatResponseStream } from "../../services/agentChatResponseStream";
import { buildAttachmentContext } from "../../services/contextAttachmentService";
import type { TabOfType } from "../../tabs/types";

interface AgentTabProps {
  tab: TabOfType<"agent">;
}

interface SavedChat {
  path: string;
  name: string;
  savedAt: string;
  preview: string;
  messageCount: number;
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

  const [selectedModel, setSelectedModel] = useState(activeModel);
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
  const agentQuestion = agentQuestions[0] || null;
  const hasActiveSubagents = subagents.some((subagent) =>
    subagent.status === "queued" || subagent.status === "running" || subagent.status === "background"
  );
  const isAgentBusy = isStreaming || hasActiveSubagents;
  const hasSelectedSkill = selectedSkillId !== null && skills.some((skill) => skill.id === selectedSkillId);

  // Chat history panel state
  const [showHistory, setShowHistory] = useState(true);
  const [chatHistory, setChatHistory] = useState<SavedChat[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [activeChatPath, setActiveChatPath] = useState<string | null>(null);

  const agentRunRef = useRef<RunHandle<"agent_chat"> | null>(null);
  const questionResolversRef = useRef<Map<string, (answer: string) => void>>(new Map());
  const consoleMessageIdRef = useRef<string | null>(null);
  const consoleBufferRef = useRef<string>("");
  const responseStreamRef = useRef<AgentChatResponseStream | null>(null);
  const chatSaveQueueRef = useRef(new AgentChatSaveQueue());
  const consoleFlushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamingResponseFlushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isStreamingRef = useRef(false);
  const lastUserMessageIdRef = useRef<string | null>(null);
  const lastConsoleMessageIdRef = useRef<string | null>(null);

  const { options: modelOptions, unauthenticatedProviders } = useSelectableModels(
    customProviders,
    providerStatus,
    activeCustomProviderId,
  );
  const modelPlaceholder = modelOptions.length === 0 && unauthenticatedProviders.length > 0
    ? `Sign in to ${unauthenticatedProviders.map((p) => p.name).join(", ")} to see more models`
    : "Select model";

  // Local-only correction (REFACTOR_PLAN.md PR 3c): if the current
  // selection isn't in THIS tab's option list, fall back locally --
  // this used to also call the global setActiveModel, which meant merely
  // mounting an Agent tab (or its option list changing) could silently
  // rewrite what every other tab defaults to. The read direction is kept:
  // when the global activeModel changes (e.g. from LlmSetupTab, the
  // canonical setter), this still re-derives selectedModel from it.
  useEffect(() => {
    const nextModel = modelOptions.some((option) => option.id === activeModel)
      ? activeModel
      : modelOptions[0]?.id || "";
    setSelectedModel(nextModel);
  }, [activeCustomProviderId, activeModel, customProviders, providerStatus]);

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
  const loadChatHistory = useCallback(async () => {
    if (!rootPath) return;
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
          });
        } catch (e) {
          console.error(`Failed to read chat ${file.path}:`, e);
        }
      }
      // Sort newest first
      loaded.sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""));
      setChatHistory(loaded);
    } catch (e) {
      setChatHistory([]);
    } finally {
      setLoadingHistory(false);
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
      updateAgentMessage(tab.id, consoleMessageIdRef.current, consoleBufferRef.current);
    }
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
    if (agentQuestions.length === 0 || !agentRunRef.current) return;
    const currentQuestion = agentQuestions[0];
    questionResolversRef.current.get(currentQuestion.requestId)?.(answer);
    questionResolversRef.current.delete(currentQuestion.requestId);
    consoleBufferRef.current = appendBoundedText(consoleBufferRef.current, `User answer: ${answer}\n`);
    if (consoleMessageIdRef.current) {
      updateAgentMessage(tab.id, consoleMessageIdRef.current, consoleBufferRef.current);
    }
    setAgentQuestions((prev) => prev.slice(1));
  };

  const handleSendMessage = async (attachedFiles: { path: string; name: string; isDir?: boolean }[]) => {
    if ((!message.trim() && attachedFiles.length === 0) || isAgentBusy) return;
    if (!hasSelectedSkill) {
      notify("Skill Required", "Select an Agent Tab skill before sending a prompt.", "error");
      return;
    }

    const now = Date.now();
    const attachments = attachedFiles.map((a) => ({ path: a.path, name: a.name, isDir: a.isDir }));
    const attachmentContext = await buildAttachmentContext(attachedFiles);

    const userText = message.trim() || (attachments.length > 0 ? "Inspect the attached context." : "");
    const userMessage: AgentMessage = {
      id: `msg_${now}`,
      role: "user" as const,
      content: userText,
      timestamp: new Date().toISOString(),
      attachments,
      attachmentContext: attachmentContext || undefined,
    };

    const consoleMessageId = `msg_${now}_console`;
    const consoleMessage: AgentMessage = {
      id: consoleMessageId,
      role: "console" as const,
      content: "",
      timestamp: new Date().toISOString(),
    };

    lastUserMessageIdRef.current = userMessage.id;
    lastConsoleMessageIdRef.current = consoleMessageId;

    addAgentMessage(tab.id, userMessage);
    addAgentMessage(tab.id, consoleMessage);
    consoleMessageIdRef.current = consoleMessageId;
    consoleBufferRef.current = "";
    responseStreamRef.current = new AgentChatResponseStream(
      (message) => addAgentMessage(tab.id, message),
      (id, content) => updateAgentMessage(tab.id, id, content),
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

    const wsRootPath = useWorkspaceStore.getState().rootPath;
    const currentProviders = useWorkspaceStore.getState().customProviders;
    const currentActiveProviderId = useWorkspaceStore.getState().activeCustomProviderId;
    const currentProviderStatus = useWorkspaceStore.getState().providerStatus;
    const resolution = resolveExecutionProvider(
      currentProviders,
      currentProviderStatus,
      currentActiveProviderId,
      selectedModel,
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
    const resolved = resolveSkill(currentSkills, selectedSkillId);
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
    const run = harness.run(
      "agent_chat",
      {
        tabId: tab.id,
        message: messageToSend,
        model: selectedModel,
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
        mcpServers,
        webSearchApiKeys: useWorkspaceStore.getState().webSearchApiKeys,
        planOnly: false,
        vfsOnly: false,
        lspSettings: { ...useWorkspaceStore.getState().lspSettings, enabled: false },
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
          case "files_changed":
            setModifiedFiles([...modifiedFilesRef.current, ...event.paths]);
            scheduleTreeRefresh();
            break;
          case "log": {
            const line = event.message.endsWith("\n") ? event.message : `${event.message}\n`;
            consoleBufferRef.current = appendBoundedText(consoleBufferRef.current, line);
            scheduleConsoleFlush();
            if (event.message.startsWith("Calling ")) {
              setStreamingLabel(event.message.replace(/\.\.\.$/, "…"));
            } else if (event.message.includes("completed") || event.message.includes("failed")) {
              setStreamingLabel("Processing results…");
            }
            break;
          }
          case "usage":
            setRunUsage(event.usage);
            break;
          case "token": {
            setStreamingLabel("Generating response…");
            responseStreamRef.current?.append(event.content, event.messageId);
            scheduleStreamingResponseFlush();
            break;
          }
          case "progress":
            responseStreamRef.current?.progress(event.content);
            break;
          case "subagent": {
            const subagent = event.subagent;
            if (!(subagent as any)?.id) break;
            const incoming = {
              ...(subagent as any),
              updatedAt: (subagent as any).updatedAt || new Date().toISOString(),
            } as SubagentActivity & { previousId?: string; appendLog?: string; logs?: string[] };
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
            : `${rootPath.replace(/[\\/]$/, "")}/${filePath.replace(/^\.\//, "")}`;
          const fileName = path.split(/[\\/]/).pop() || path;
          openTab({ type: "file", path, title: fileName });
        });
        // Refresh after opening the returned files.  The agent may have
        // created them during the run, so the explorer must observe the
        // completed writes rather than only the command-output refresh.
        if (files.length > 0 && rootPath) {
          await refreshTree();
        }

        const finalResponse = response || "Agent complete.";
        if (completedSubagents.length > 0) {
          // The completed response can contain each subagent's full result.
          // Keep the panel focused on status and its last few activity lines.
          setSubagents((completedSubagents as SubagentActivity[]).map((subagent) => ({
            ...subagent,
            logs: (subagent.logs || []).slice(-4),
          })));
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
        consoleBufferRef.current = appendBoundedText(consoleBufferRef.current, `Error: ${message}\n`);
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
          content: `Error: ${message}`,
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
        notify("Agent Error", `The agent encountered an error: ${message}`, "error");
        saveChatHistory();
      }
    });
    agentRunRef.current = run;
  };

  const handleOpenModifiedFile = (filePath: string) => {
    const fileName = filePath.split(/[\\/]/).pop() || filePath;
    openTab({ type: "file", path: filePath, title: fileName });
  };

  const saveChatHistory = async () => {
    if (!rootPath) return;
    // Snapshot synchronously: closing the tab removes its messages from
    // the store, and a later render may belong to a different conversation.
    const messages = useWorkspaceStore.getState().agentChats[tab.id] || [];
    const queue = chatSaveQueueRef.current;
    try {
      await queue.save(rootPath, tab.id, messages, modifiedFilesRef.current);
      if (chatSaveQueueRef.current === queue) setActiveChatPath(queue.path);
      await loadChatHistory();
    } catch (error) {
      console.error("Failed to save chat history:", error);
      notify("Chat not saved", "Could not save this conversation. Please check workspace access.", "error");
    }
  };

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
                setSelectedModel(model);
                setActiveModel(model);
              }}
              options={modelOptions}
              placeholder={modelPlaceholder}
              className="w-64"
            />
            <CustomSelect
              value={selectedSkillId || DEFAULT_SKILL_ID}
              onChange={(val) => {
                if (!val) return;
                setSelectedSkillId(val);
                setActiveSkill(val);
              }}
              options={skills.filter(s => !s.isInternal).map(s => ({ id: s.id, name: s.name }))}
              placeholder="Select skill"
              className="w-48"
            />
            {modifiedFiles.length > 0 && (
              <span className="flex items-center space-x-1.5 px-2.5 py-1 bg-[var(--color-status-success-bg)] border border-[var(--color-status-success-border)] rounded-lg text-[10px] font-mono text-[var(--color-status-success)]">
                <CheckCircle2 size={11} />
                <span>{modifiedFiles.length} file{modifiedFiles.length !== 1 ? "s" : ""} modified</span>
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2 text-[var(--text-muted)] font-mono text-[10px]">
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
          <Chat
            messages={agentChats}
            isStreaming={isAgentBusy}
            streamingMessageId={consoleMessageIdRef.current}
            streamingLabel={streamingLabel}
            subagents={subagents}
            followLatest
          />
          
          <div className="px-3 py-2 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-header)] flex-shrink-0 w-full">
            <ChatInput
              value={message}
              onChange={setMessage}
              onSend={handleSendMessage}
              disabled={isAgentBusy || !hasSelectedSkill}
              isStreaming={isAgentBusy}
              onStop={handleStopExecution}
              agentQuestion={agentQuestion}
              onAgentQuestionAnswer={handleAgentQuestionAnswer}
              placeholder="Message agent... (type @ to reference files)"
            />
          </div>
        </div>

      </div>
    </div>
  );
};
