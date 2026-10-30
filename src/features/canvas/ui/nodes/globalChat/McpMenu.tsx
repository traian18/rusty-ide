import React from "react";
import type { McpServer } from "./globalChatTypes";
import { stopNodePropagation } from "./stopPropagation";

interface McpMenuProps {
  mcpServers: Record<string, McpServer>;
  currentServerName: string;
  onSelect: (serverName: string) => void;
}

/**
 * Dropdown list of all available MCP servers plus a "none" option
 * to clear the override.
 *
 * Highlights the currently selected server with an accent background.
 */
export const McpMenu: React.FC<McpMenuProps> = ({
  mcpServers,
  currentServerName,
  onSelect,
}) => {
  return (
    <div
      className="absolute z-30 left-0 right-0 mt-1 bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded shadow-xl py-1 max-h-44 overflow-y-auto font-mono"
      onClick={stopNodePropagation}
    >
      {/* "None" option */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onSelect("");
        }}
        onPointerDown={stopNodePropagation}
        className={`w-full text-left px-2.5 py-1.5 text-[10px] font-mono transition-colors ${
          currentServerName === ""
            ? "text-[var(--text-light)] bg-[var(--accent-bg)]"
            : "text-[var(--text-muted)] hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)]"
        }`}
      >
        MCP override: none
      </button>

      {/* Server entries */}
      {Object.entries(mcpServers).map(([name, server]) => {
        const isSelected = currentServerName === name;

        return (
          <button
            key={name}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(name);
            }}
            onPointerDown={stopNodePropagation}
            className={`w-full text-left px-2.5 py-1.5 text-[10px] font-mono transition-colors flex items-center justify-between ${
              isSelected
                ? "text-[var(--text-light)] bg-[var(--accent-bg)]"
                : "text-[var(--text-normal)] hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)]"
            }`}
          >
            <span className="truncate">
              {server.displayName || server.name || name}
            </span>
            <span className="text-[8px] font-mono ml-2 text-[var(--text-muted)]">
              {server.transport.type}
            </span>
          </button>
        );
      })}
    </div>
  );
};
