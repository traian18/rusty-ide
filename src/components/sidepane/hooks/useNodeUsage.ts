/**
 * useNodeUsage.ts
 *
 * Listens for custom `rusty-node-usage` events dispatched by executor
 * processes and surfaces the latest token-usage payload for a given node.
 */

import { useState, useEffect } from "react";

/**
 * Represents a token usage snapshot for a single execution.
 */
export interface TokenUsageLike {
  input: number;
  output: number;
  totalTokens?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/**
 * Tracks the most recent token-usage payload for the given node.
 *
 * Resets to `null` whenever `selectedNodeId` changes and re-subscribes to the
 * custom DOM event `rusty-node-usage`.
 *
 * @param selectedNodeId - The node whose usage data to follow.
 * @returns The latest usage snapshot, or `null`.
 */
export function useNodeUsage(
  selectedNodeId: string | null
): TokenUsageLike | null {
  const [nodeUsage, setNodeUsage] = useState<TokenUsageLike | null>(null);

  useEffect(() => {
    setNodeUsage(null);
    if (!selectedNodeId) return;

    const handleNodeUsage = (event: Event): void => {
      const detail = (
        event as CustomEvent<{ nodeId: string; usage: TokenUsageLike }>
      ).detail;
      if (detail?.nodeId === selectedNodeId) {
        setNodeUsage(detail.usage);
      }
    };

    window.addEventListener("rusty-node-usage", handleNodeUsage);
    return () => {
      window.removeEventListener("rusty-node-usage", handleNodeUsage);
    };
  }, [selectedNodeId]);

  return nodeUsage;
}
