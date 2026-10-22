import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentMessage } from "../../../store";
import { createChatSearchIndex, findChatSearchMatches, type ChatSearchIndex } from "../../ui/chatSearch";

/** For each message, the user query it answers (the latest user message at or before it). */
function queryIdsByMessage(chats: AgentMessage[]): Map<string, string> {
  const result = new Map<string, string>();
  let queryId: string | undefined;
  for (const chat of chats) {
    if (chat.role === "user") queryId = chat.id;
    if (queryId) result.set(chat.id, queryId);
  }
  return result;
}

/** The chat's search box and query rail: what matches, which match and query
 * are current, and scrolling to them. */
export function useChatSearch(agentChats: AgentMessage[]) {
  const [chatSearch, setChatSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const [activeQueryId, setActiveQueryId] = useState<string>();
  const [scrollTarget, setScrollTarget] = useState<{ messageId: string; token: number }>();
  const navigationTokenRef = useRef(0);
  const searchIndexRef = useRef<ChatSearchIndex | undefined>(undefined);

  const queryMetadata = useMemo(() => agentChats
    .filter((chat) => chat.role === "user")
    .map((chat, index) => ({ id: chat.id, index: index + 1, label: chat.content.trim() || `Query ${index + 1}` })), [agentChats]);
  const searchIndex = useMemo(() => {
    searchIndexRef.current = createChatSearchIndex(agentChats, searchIndexRef.current);
    return searchIndexRef.current;
  }, [agentChats]);
  const searchMatches = useMemo(() => findChatSearchMatches(agentChats, chatSearch, searchIndex), [agentChats, chatSearch, searchIndex]);
  const messageIndexById = useMemo(() => new Map(agentChats.map((chat, index) => [chat.id, index])), [agentChats]);
  const queryIdByMessageId = useMemo(() => queryIdsByMessage(agentChats), [agentChats]);
  const firstSearchIndexByMessageId = useMemo(() => {
    const result = new Map<string, number>();
    searchMatches.forEach((match, index) => {
      if (!result.has(match.messageId)) result.set(match.messageId, index);
    });
    return result;
  }, [searchMatches]);

  const navigateToMessage = useCallback((messageId: string) => {
    navigationTokenRef.current += 1;
    setScrollTarget({ messageId, token: navigationTokenRef.current });
  }, []);
  const selectQuery = useCallback((messageId: string) => {
    setActiveQueryId(messageId);
    navigateToMessage(messageId);
  }, [navigateToMessage]);
  const handleVisibleMessageChange = useCallback((messageId: string) => {
    if (!messageIndexById.has(messageId)) return;
    const queryId = queryIdByMessageId.get(messageId);
    setActiveQueryId((current) => current === queryId ? current : queryId);
    const matchIndex = chatSearch.trim() ? firstSearchIndexByMessageId.get(messageId) : undefined;
    if (matchIndex !== undefined) setActiveSearchIndex((current) => current === matchIndex ? current : matchIndex);
  }, [messageIndexById, queryIdByMessageId, chatSearch, firstSearchIndexByMessageId]);
  useEffect(() => {
    setActiveSearchIndex((current) => searchMatches.length === 0 ? 0 : Math.min(current, searchMatches.length - 1));
  }, [searchMatches]);
  useEffect(() => {
    setActiveSearchIndex(0);
  }, [chatSearch]);

  /** Moves to the next (`1`) or previous (`-1`) match, wrapping around. */
  const stepMatch = (delta: 1 | -1) => {
    const count = searchMatches.length;
    const next = count ? (activeSearchIndex + delta + count) % count : 0;
    setActiveSearchIndex(next);
    if (searchMatches[next]) navigateToMessage(searchMatches[next].messageId);
  };
  const closeSearch = () => {
    setChatSearch("");
    setSearchOpen(false);
  };
  const onScrollTargetHandled = (messageId: string) => {
    setScrollTarget((current) => current?.messageId === messageId ? undefined : current);
  };

  return {
    chatSearch, setChatSearch, searchOpen, openSearch: () => setSearchOpen(true), closeSearch, stepMatch,
    searchMatches, activeSearchMatch: searchMatches[activeSearchIndex], queryMetadata, activeQueryId,
    scrollTarget, selectQuery, handleVisibleMessageChange, onScrollTargetHandled,
  };
}

export type ChatSearch = ReturnType<typeof useChatSearch>;
