/**
 * Content area of the GlobalChatNode.
 *
 * Renders:
 * 1. A skill selector dropdown — determines the system prompt, tools, and MCP servers.
 * 2. An MCP server override dropdown — lets users route requests through a specific server.
 * 3. A summary / "Background Context" block, or an empty-state prompt when no summary exists.
 */

import React, { useState } from "react";
import {
  BookOpen,
  ChevronDown,
  Plug,
} from "lucide-react";
import {
  GLOBAL_CHAT_DEFAULT_SKILL_ID,
  GLOBAL_CHAT_SKILL_IDS,
} from "../../../../skills";
import { stopNodePropagation } from "./stopPropagation";
import type { McpServer, Skill } from "./globalChatTypes";
import { SkillMenu } from "./SkillMenu";
import { McpMenu } from "./McpMenu";
import { SummaryBlock, EmptyState } from "./SummaryBlock";



interface GlobalChatNodeContentProps {
  /** The raw node data object from the store. */
  data: {
    skillId?: string;
    mcpServerName?: string;
    summary?: string;
  };
  /** All registered skills from the store. */
  skills: Skill[];
  /** All registered MCP servers keyed by name. */
  mcpServers: Record<string, McpServer>;
  /** Store action to update a node's data. */
  updateNode: (id: string, data: Record<string, unknown>) => void;
  /** The node's unique identifier. */
  id: string;
  /** Ref for the outer scrollable container (used for wheel prevention). */
  contentRef: React.RefObject<HTMLDivElement | null>;
}

export const GlobalChatNodeContent: React.FC<GlobalChatNodeContentProps> = ({
  data,
  skills,
  mcpServers,
  updateNode,
  id,
  contentRef,
}) => {
  /* ── Dropdown open/close state ───────────────────────────────── */
  const [mcpMenuOpen, setMcpMenuOpen] = useState(false);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);

  /* ── Derived values ──────────────────────────────────────────── */
  const selectedSkillId = GLOBAL_CHAT_SKILL_IDS.includes(data.skillId ?? "")
    ? data.skillId
    : GLOBAL_CHAT_DEFAULT_SKILL_ID;

  const hasSummary = !!data.summary;

  /* ── Handlers ────────────────────────────────────────────────── */

  /** Select a skill and close both menus. */
  const handleSkillSelect = (skillId: string) => {
    updateNode(id, { skillId });
    setSkillMenuOpen(false);
  };

  /** Select an MCP server override (empty string = no override). */
  const handleMcpSelect = (serverName: string) => {
    updateNode(id, { mcpServerName: serverName });
    setMcpMenuOpen(false);
  };

  /** Toggle the skill menu and close the MCP menu. */
  const toggleSkillMenu = () => {
    setSkillMenuOpen((prev) => !prev);
    setMcpMenuOpen(false);
  };

  /** Toggle the MCP menu and close the skill menu. */
  const toggleMcpMenu = () => {
    setMcpMenuOpen((prev) => !prev);
    setSkillMenuOpen(false);
  };

  /* ── Render ──────────────────────────────────────────────────── */
  return (
    <div
      ref={contentRef}
      className="p-3 flex-1 flex flex-col min-h-0 overflow-y-auto scrollbar-wider"
    >
      {/* ── Skill Selector ─────────────────────────────────────── */}
      <div className="flex-shrink-0 mb-1.5 font-mono">
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleSkillMenu();
            }}
            onPointerDown={stopNodePropagation}
            onMouseDown={stopNodePropagation}
            className="nodrag w-full bg-[var(--bg-app)] border border-[var(--border-color)]/70 rounded px-2 py-1 text-[10px] font-mono text-left flex items-center justify-between hover:border-[var(--accent-color)]/40 transition-colors"
            title="Select a skill to use its system prompt, tools, and MCP servers"
          >
            <span className="flex items-center space-x-1.5 min-w-0">
              <BookOpen
                size={11}
                className="text-[var(--color-status-warning)] flex-shrink-0"
              />
              <span className="text-[var(--text-light)] truncate">
                {skills.find((s) => s.id === selectedSkillId)?.name ??
                  selectedSkillId}
              </span>
            </span>
            <ChevronDown
              size={11}
              className="text-[var(--text-muted)] flex-shrink-0 ml-2"
            />
          </button>

          {skillMenuOpen && (
            <SkillMenu
              skills={skills}
              selectedSkillId={selectedSkillId}
              onSelect={handleSkillSelect}
            />
          )}
        </div>
      </div>

      {/* ── MCP Server Override Selector ───────────────────────── */}
      <div className="flex-shrink-0 mb-2 font-mono">
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleMcpMenu();
            }}
            onPointerDown={stopNodePropagation}
            onMouseDown={stopNodePropagation}
            className="nodrag w-full bg-[var(--bg-app)] border border-[var(--border-color)]/70 rounded px-2 py-1 text-[10px] font-mono text-left flex items-center justify-between hover:border-[var(--accent-color)]/40 transition-colors"
            title="Route requests through an MCP server (Jira, Confluence, etc)"
          >
            <span className="flex items-center space-x-1.5 min-w-0">
              <Plug
                size={11}
                className="text-[var(--color-status-info)] flex-shrink-0"
              />
              <span
                className={
                  data.mcpServerName
                    ? "text-[var(--text-light)] truncate"
                    : "text-[var(--text-muted)] truncate"
                }
              >
                {data.mcpServerName
                  ? mcpServers[data.mcpServerName]?.displayName ??
                    data.mcpServerName
                  : "MCP override: none"}
              </span>
            </span>
            <ChevronDown
              size={11}
              className="text-[var(--text-muted)] flex-shrink-0 ml-2"
            />
          </button>

          {mcpMenuOpen && (
            <McpMenu
              mcpServers={mcpServers}
              currentServerName={data.mcpServerName ?? ""}
              onSelect={handleMcpSelect}
            />
          )}
        </div>
      </div>

      {/* ── Summary / Empty State ──────────────────────────────── */}
      {hasSummary ? (
        <SummaryBlock summary={data.summary ?? ""} />
      ) : (
        <EmptyState />
      )}
    </div>
  );
};

/* =================================================================
 * Sub-components (used only within this file — no nested functions)
 * ================================================================= */







