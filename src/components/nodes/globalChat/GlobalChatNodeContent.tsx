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
  Lightbulb,
} from "lucide-react";
import { processResponse } from "../../../services/responseProcessingService";
import {
  GLOBAL_CHAT_DEFAULT_SKILL_ID,
  GLOBAL_CHAT_SKILL_IDS,
} from "../../../config/skillDefinitions";
import { stopNodePropagation } from "./stopPropagation";

interface McpServer {
  name?: string;
  displayName?: string;
  transport: { type: string };
}

interface Skill {
  id: string;
  name: string;
  mcpServers?: string[];
}

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

interface SkillMenuProps {
  skills: Skill[];
  selectedSkillId: string | undefined;
  onSelect: (skillId: string) => void;
}

/**
 * Dropdown list of available skills filtered to those allowed for
 * Global Chat (planning and analysis skills only).
 *
 * Highlights the currently selected skill with an accent background.
 */
const SkillMenu: React.FC<SkillMenuProps> = ({
  skills,
  selectedSkillId,
  onSelect,
}) => {
  const allowedSkills = skills.filter((s) =>
    GLOBAL_CHAT_SKILL_IDS.includes(s.id),
  );

  return (
    <div
      className="absolute z-30 left-0 right-0 mt-1 bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded shadow-xl py-1 max-h-44 overflow-y-auto font-mono"
      onClick={stopNodePropagation}
    >
      {allowedSkills.map((skill) => {
        const isSelected = skill.id === selectedSkillId;

        return (
          <button
            key={skill.id}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(skill.id);
            }}
            onPointerDown={stopNodePropagation}
            className={`w-full text-left px-2.5 py-1.5 text-[10px] font-mono transition-colors flex items-center justify-between ${
              isSelected
                ? "text-[var(--text-light)] bg-[var(--accent-bg)]"
                : "text-[var(--text-normal)] hover:bg-[var(--accent-bg)] hover:text-[var(--text-light)]"
            }`}
          >
            <span className="truncate">{skill.name}</span>
            {Array.isArray(skill.mcpServers) &&
              skill.mcpServers.length > 0 && (
                <span className="text-[8px] font-mono ml-2 text-[var(--color-status-info)] flex-shrink-0">
                  <Plug size={8} className="inline mr-0.5" />
                  {skill.mcpServers.length} MCP
                </span>
              )}
          </button>
        );
      })}
    </div>
  );
};

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
const McpMenu: React.FC<McpMenuProps> = ({
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

interface SummaryBlockProps {
  summary: string;
}

/**
 * Renders the "Background Context" block containing processed summary text.
 */
const SummaryBlock: React.FC<SummaryBlockProps> = ({ summary }) => {
  return (
    <div className="flex flex-col flex-1 min-h-0 space-y-1.5">
      <div className="text-[9px] uppercase font-bold text-[var(--color-status-warning)] font-mono tracking-wide flex-shrink-0">
        Background Context
      </div>
      <div
        className="nodrag text-[11px] font-mono text-[var(--text-normal)] leading-relaxed flex-1 min-h-0 whitespace-pre-wrap bg-[var(--color-surface-sunken)] rounded-md p-2.5 border border-[var(--border-color)]/70 w-full antialiased subpixel-antialiased select-text overflow-y-auto scrollbar-wider"
        onPointerDown={stopNodePropagation}
        onMouseDown={stopNodePropagation}
      >
        {processResponse(summary)}
      </div>
    </div>
  );
};

/**
 * Empty state placeholder shown when no summary has been generated yet.
 */
const EmptyState: React.FC = () => {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center text-xs font-sans text-[var(--text-muted)] p-4 select-none">
      <Lightbulb
        size={24}
        className="mx-auto text-[var(--color-status-warning)] mb-2"
      />
      <span>
        Select this node to discuss tasks and build context for TaskNodes.
      </span>
    </div>
  );
};
