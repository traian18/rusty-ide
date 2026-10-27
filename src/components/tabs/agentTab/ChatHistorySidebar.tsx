import React from "react";
import { History, Trash2, Plus, RefreshCw, PanelLeftClose } from "lucide-react";
import type { SavedChat } from "./savedChats";

interface ChatHistorySidebarProps {
  chats: SavedChat[];
  activeChatPath: string | null;
  loading: boolean;
  onRefresh: () => void;
  onNewChat: () => void;
  onHide: () => void;
  onLoad: (chat: SavedChat) => void;
  onDelete: (event: React.MouseEvent, chat: SavedChat) => void;
  /** How the chat is going when it is open in the tab: running, or waiting for an answer. */
  statusOf: (chat: SavedChat) => "running" | "input" | undefined;
}

/** Today's chats show their time, older ones their date. */
function savedAtLabel(savedAt: string): string {
  if (!savedAt) return "";
  const date = new Date(savedAt);
  return date.toLocaleDateString() === new Date().toLocaleDateString()
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

const iconButton = "p-1 rounded hover:bg-[var(--accent-bg)] text-[var(--text-muted)] transition-colors cursor-pointer border-none bg-transparent";

function SavedChatRow({ chat, active, status, onLoad, onDelete }: {
  chat: SavedChat;
  active: boolean;
  status: "running" | "input" | undefined;
  onLoad: ChatHistorySidebarProps["onLoad"];
  onDelete: ChatHistorySidebarProps["onDelete"];
}) {
  return (
    <div
      onClick={() => onLoad(chat)}
      className={`group mx-1.5 my-0.5 px-2.5 py-2 rounded-lg cursor-pointer transition-all border ${
        active
          ? "border-[var(--accent-color)] bg-[var(--accent-bg)]/30"
          : "border-transparent hover:bg-[var(--bg-app)]/50 hover:border-[var(--border-color)]"
      }`}
    >
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[9px] font-mono text-[var(--text-muted)]">
          {savedAtLabel(chat.savedAt)}
          {status && (
            <span role="status" className={`ml-1.5 ${status === "input" ? "text-[var(--color-status-warning)]" : "text-[var(--accent-color)]"}`}>
              {status === "input" ? "needs your answer" : "running"}
            </span>
          )}
        </span>
        <div className="flex items-center space-x-1">
          <span className="text-[8px] font-mono text-[var(--text-muted)]">{chat.messageCount} msgs</span>
          <button
            onClick={(e) => onDelete(e, chat)}
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-[var(--color-status-danger)] hover:text-[var(--color-status-danger)] transition-all p-0.5 border-none bg-transparent cursor-pointer"
            title="Delete chat"
          >
            <Trash2 size={10} />
          </button>
        </div>
      </div>
      <p className={`text-[11px] font-mono leading-snug line-clamp-2 ${active ? "text-[var(--text-light)]" : "text-[var(--text-normal)]"}`}>
        {chat.preview}
      </p>
    </div>
  );
}

/** The saved chats of the workspace, newest first. */
export const ChatHistorySidebar: React.FC<ChatHistorySidebarProps> = ({
  chats, activeChatPath, loading, onRefresh, onNewChat, onHide, onLoad, onDelete, statusOf,
}) => (
  <div className="w-64 flex-shrink-0 border-r border-[var(--border-color)] bg-[var(--bg-sidebar)]/40 flex flex-col h-full overflow-hidden">
    <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] flex-shrink-0">
      <div className="flex items-center space-x-1.5 text-[var(--text-muted)]">
        <History size={13} />
        <span className="text-[10px] font-mono uppercase tracking-wider font-bold">Chats</span>
        <span className="text-[9px] font-mono text-[var(--text-muted)]">({chats.length})</span>
      </div>
      <div className="flex items-center space-x-1">
        <button onClick={onRefresh} disabled={loading} className={`${iconButton} hover:text-[var(--text-light)]`} title="Refresh">
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
        </button>
        <button onClick={onNewChat} className={`${iconButton} hover:text-[var(--text-color)]`} title="New chat">
          <Plus size={12} />
        </button>
        <button onClick={onHide} className={`${iconButton} hover:text-[var(--text-light)]`} title="Hide history">
          <PanelLeftClose size={12} />
        </button>
      </div>
    </div>

    <div className="flex-1 overflow-y-auto py-1">
      {chats.length === 0 ? (
        <div className="px-3 py-6 text-center text-[10px] font-mono text-[var(--text-muted)] leading-relaxed">
          {loading ? "Loading..." : "No saved chats yet.\nStart a conversation to see it here."}
        </div>
      ) : (
        chats.map((chat) => (
          <SavedChatRow key={chat.path} chat={chat} active={activeChatPath === chat.path} status={statusOf(chat)} onLoad={onLoad} onDelete={onDelete} />
        ))
      )}
    </div>
  </div>
);
