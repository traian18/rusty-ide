import React, { useRef, useEffect } from "react";
import { useWorkspaceStore } from "../../../store";

interface ConsoleTabContentProps {
  selectedNodeId: string;
  tabId?: string;
}

const EMPTY_ARRAY: any[] = [];

export const ConsoleTabContent: React.FC<ConsoleTabContentProps> = ({ selectedNodeId, tabId }) => {
  const nodeLogs = useWorkspaceStore((state) => {
    if (tabId) {
      return state.canvasContexts[tabId]?.nodeLogs[selectedNodeId] || EMPTY_ARRAY;
    }
    return state.nodeLogs[selectedNodeId] || EMPTY_ARRAY;
  });
  const nodeStatus = useWorkspaceStore((state) => {
    if (tabId) {
      return state.canvasContexts[tabId]?.nodeStatus[selectedNodeId] || "idle";
    }
    return state.nodeStatus[selectedNodeId] || "idle";
  });

  const consoleScrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const previousLogCountRef = useRef(0);

  useEffect(() => {
    if (!selectedNodeId) return;
    const savedPos = localStorage.getItem(`console_scroll_${selectedNodeId}`);
    if (savedPos && consoleScrollRef.current) {
      consoleScrollRef.current.scrollTop = parseInt(savedPos, 10);
    }
    previousLogCountRef.current = nodeLogs.length;
  }, [selectedNodeId]);

  useEffect(() => {
    if (!consoleScrollRef.current) return;

    const isStreaming = nodeStatus === "running";
    const newLogsArrived = nodeLogs.length > previousLogCountRef.current;
    previousLogCountRef.current = nodeLogs.length;

    if (isStreaming && newLogsArrived && isAtBottomRef.current) {
      consoleScrollRef.current.scrollTop = consoleScrollRef.current.scrollHeight;
    }
  }, [nodeLogs.length, nodeStatus]);

  const handleScroll = () => {
    if (!consoleScrollRef.current || !selectedNodeId) return;
    const { scrollTop, scrollHeight, clientHeight } = consoleScrollRef.current;
    localStorage.setItem(`console_scroll_${selectedNodeId}`, String(scrollTop));
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    isAtBottomRef.current = distanceFromBottom < 50;
  };

  return (
    <div
      ref={consoleScrollRef}
      onScroll={handleScroll}
      className="flex flex-col h-full p-4 font-mono text-xs bg-[var(--color-log-background)] text-[var(--color-log-foreground)] overflow-y-auto space-y-1"
    >
      {nodeLogs.length === 0 ? (
        <span className="text-[var(--color-log-muted)]">// No execution logs yet.</span>
      ) : (
        nodeLogs.map((log: string, idx: number) => (
          <div key={idx} className="whitespace-pre-wrap leading-relaxed">
            {log}
          </div>
        ))
      )}
    </div>
  );
};
