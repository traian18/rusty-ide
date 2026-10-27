import { Plus, X } from "lucide-react";
import { useWorkspaceStore } from "../../../store";
import { chatNeedsInput, isChatBusy, useChatStore } from "./chats/chatStore";
import { chatTitle } from "./chats/chatTitle";

type ChatStatus = "idle" | "running" | "input";

const STATUS_LABEL: Record<ChatStatus, string> = { idle: "Idle", running: "Running", input: "Needs your answer" };
const STATUS_DOT: Record<ChatStatus, string> = {
  idle: "bg-[var(--text-muted)] opacity-40",
  running: "bg-[var(--accent-color)] animate-pulse",
  input: "bg-[var(--color-status-warning-solid)]",
};

function ChatPill({ chatId, active, closable, onSelect, onClose }: {
  chatId: string;
  active: boolean;
  closable: boolean;
  onSelect: (chatId: string) => void;
  onClose: (chatId: string) => void;
}) {
  const view = useChatStore((s) => s.chats[chatId]);
  const title = useWorkspaceStore((s) => chatTitle(s.agentChats[chatId]));
  const status: ChatStatus = chatNeedsInput(view) ? "input" : isChatBusy(view) ? "running" : "idle";
  return (
    <div
      role="tab"
      aria-selected={active}
      data-chat-id={chatId}
      data-status={status}
      title={`${title} · ${STATUS_LABEL[status]}`}
      onClick={() => onSelect(chatId)}
      className={`group flex items-center gap-1.5 max-w-[220px] pl-2.5 pr-1 py-1 rounded-md cursor-pointer border text-[10px] font-mono flex-shrink-0 transition-colors ${
        active
          ? "border-[var(--accent-color)] bg-[var(--accent-bg)]/30 text-[var(--text-light)]"
          : "border-transparent text-[var(--text-muted)] hover:bg-[var(--bg-app)]/60 hover:border-[var(--border-color)]"
      }`}
    >
      <span aria-label={STATUS_LABEL[status]} className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[status]}`} />
      <span className="truncate">{title}</span>
      {closable && (
        <button
          type="button"
          aria-label={`Close ${title}`}
          title={status === "idle" ? "Close chat" : "Stop and close chat"}
          onClick={(event) => {
            event.stopPropagation();
            onClose(chatId);
          }}
          className="p-0.5 rounded border-none bg-transparent cursor-pointer text-[var(--text-muted)] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-[var(--text-light)]"
        >
          <X size={10} />
        </button>
      )}
    </div>
  );
}

/** The tab's open chats, each going on with its own run; the shown one is highlighted. */
export function ChatStrip({ tabId, onSelect, onClose, onNewChat }: {
  tabId: string;
  onSelect: (chatId: string) => void;
  onClose: (chatId: string) => void;
  onNewChat: () => void;
}) {
  const tab = useChatStore((s) => s.tabs[tabId]);
  const order = tab?.order ?? [];
  // A lone chat is not closed: + opens another beside it, or starts it over when blank.
  const closable = order.length > 1;
  return (
    <div role="tablist" aria-label="Open chats" className="flex items-center gap-1 px-3 py-1 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/20 overflow-x-auto flex-shrink-0">
      {order.map((chatId) => (
        <ChatPill key={chatId} chatId={chatId} active={tab?.activeChatId === chatId} closable={closable} onSelect={onSelect} onClose={onClose} />
      ))}
      <button
        type="button"
        id="agent-new-chat"
        aria-label="New chat"
        title="New chat"
        onClick={onNewChat}
        className="p-1 rounded border-none bg-transparent cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-light)] hover:bg-[var(--accent-bg)] flex-shrink-0"
      >
        <Plus size={12} />
      </button>
    </div>
  );
}
