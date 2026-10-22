import { useCallback, useEffect, useRef, useState } from "react";
import { listSavedChats, type SavedChat } from "./savedChats";

/** The workspace's saved chats, for the history panel. A load overtaken by a
 * newer one (another workspace, a refresh) does not apply. */
export function useSavedChats(rootPath: string) {
  const [chatHistory, setChatHistory] = useState<SavedChat[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const loadIdRef = useRef(0);

  const loadChatHistory = useCallback(async () => {
    const loadId = ++loadIdRef.current;
    const current = () => loadIdRef.current === loadId;
    if (!rootPath) {
      setChatHistory([]);
      setLoadingHistory(false);
      return;
    }
    setLoadingHistory(true);
    try {
      const loaded = await listSavedChats(rootPath);
      if (current()) setChatHistory(loaded);
    } catch {
      // No `.rusty/chats` yet: the workspace has no saved chats.
      if (current()) setChatHistory([]);
    } finally {
      if (current()) setLoadingHistory(false);
    }
  }, [rootPath]);

  useEffect(() => {
    void loadChatHistory();
  }, [loadChatHistory]);

  const removeChat = (path: string) => setChatHistory((prev) => prev.filter((c) => c.path !== path));

  return { chatHistory, loadingHistory, loadChatHistory, removeChat };
}
