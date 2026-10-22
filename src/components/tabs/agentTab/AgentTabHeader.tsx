import React from "react";
import { PanelLeft, CheckCircle2, Search, X } from "lucide-react";
import { BUILT_IN_SKILL_IDS, DEFAULT_SKILL_ID } from "../../../config/skillDefinitions";
import { CustomSelect } from "../../CustomSelect";
import { TokenBadge, type TokenUsageLike } from "../../ui/TokenBadge/TokenBadge";
import type { useAgentModel, useSkillChoice } from "./useAgentModel";
import type { ChatSearch } from "./useChatSearch";

interface AgentTabHeaderProps {
  historyHidden: boolean;
  onShowHistory: () => void;
  model: ReturnType<typeof useAgentModel>;
  skill: ReturnType<typeof useSkillChoice>;
  /** A followed workflow decides each step's tools, so the skill picker is inert. */
  skillLocked: boolean;
  modifiedFileCount: number;
  search: ChatSearch;
  runUsage: TokenUsageLike | null;
  isStreaming: boolean;
  isAgentBusy: boolean;
  hasActiveSubagents: boolean;
}

/** Workflow steps get their tools from their own profiles, so a followed
 * workflow keeps the skill on Build (the full tool set) and the picker inert. */
function SkillPicker({ skill, locked }: { skill: AgentTabHeaderProps["skill"]; locked: boolean }) {
  return (
    <div
      className="flex items-center space-x-2"
      title={locked ? "While a workflow is followed, each step's profile decides its tools, so the skill stays on Build." : undefined}
    >
      <CustomSelect
        value={locked ? BUILT_IN_SKILL_IDS.BUILD : skill.selectedSkillId || DEFAULT_SKILL_ID}
        onChange={skill.selectSkill}
        options={skill.options}
        placeholder="Select skill"
        className="w-48"
        disabled={locked}
      />
      {locked ? (
        <span className="text-[10px] font-mono text-[var(--text-muted)] whitespace-nowrap">tools set per step</span>
      ) : null}
    </div>
  );
}

function ModifiedFileCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="flex items-center space-x-1.5 px-2.5 py-1 bg-[var(--color-status-success-bg)] border border-[var(--color-status-success-border)] rounded-lg text-[10px] font-mono text-[var(--color-status-success)]">
      <CheckCircle2 size={11} />
      <span title={`${count} file${count !== 1 ? "s" : ""} modified`}>{count}</span>
    </span>
  );
}

function ChatSearchControls({ search }: { search: ChatSearch }) {
  if (!search.searchOpen) {
    return (
      <button type="button" id="agent-chat-search-open" aria-label="Search chat" title="Search chat" onClick={search.openSearch}>
        <Search size={12} />
      </button>
    );
  }
  const noMatches = !search.chatSearch.trim() || search.searchMatches.length === 0;
  const count = search.searchMatches.length;
  return (
    <>
      <label htmlFor="agent-chat-search" className="sr-only">Search chat messages</label>
      <input
        id="agent-chat-search"
        autoFocus
        value={search.chatSearch}
        onChange={(event) => search.setChatSearch(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") search.closeSearch();
        }}
        placeholder="Search chat"
        className="w-40 rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-app)] px-2 py-1 text-xs text-[var(--color-fg-default)]"
      />
      <button type="button" id="agent-chat-search-previous" aria-label="Previous chat match" title="Previous chat match" disabled={noMatches} onClick={() => search.stepMatch(-1)}>Prev</button>
      <button type="button" id="agent-chat-search-next" aria-label="Next chat match" title="Next chat match" disabled={noMatches} onClick={() => search.stepMatch(1)}>Next</button>
      <span id="agent-chat-search-status" aria-live="polite">
        {count} {count === 1 ? "match" : "matches"}
      </span>
      <button type="button" id="agent-chat-search-close" aria-label="Close chat search" title="Close search" onClick={search.closeSearch}>
        <X size={12} />
      </button>
    </>
  );
}

function runStatus({ isStreaming, hasActiveSubagents }: Pick<AgentTabHeaderProps, "isStreaming" | "hasActiveSubagents">): string {
  if (isStreaming) return "Thinking";
  return hasActiveSubagents ? "Subagents working" : "Ready";
}

/** The tab's header: the model and skill pickers, the changed-file count, chat search and run status. */
export const AgentTabHeader: React.FC<AgentTabHeaderProps> = (props) => {
  const { model, search, runUsage, isStreaming, isAgentBusy } = props;
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/50 flex-shrink-0">
      <div className="flex items-center space-x-3">
        {props.historyHidden && (
          <button
            onClick={props.onShowHistory}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-light)] hover:bg-[var(--accent-bg)] transition-colors cursor-pointer border-none bg-transparent"
            title="Show chat history"
          >
            <PanelLeft size={16} />
          </button>
        )}
        <CustomSelect value={model.selectedModel} onChange={model.selectModel} options={model.options} placeholder={model.placeholder} className="w-64" />
        <SkillPicker skill={props.skill} locked={props.skillLocked} />
        <ModifiedFileCount count={props.modifiedFileCount} />
      </div>
      <div className="flex items-center space-x-2 text-[var(--text-muted)] font-mono text-[10px]">
        <ChatSearchControls search={search} />
        {runUsage && <TokenBadge usage={runUsage} live={isStreaming} />}
        {isAgentBusy && <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-color)] animate-ping" />}
        <span>{runStatus(props)}</span>
      </div>
    </div>
  );
};
