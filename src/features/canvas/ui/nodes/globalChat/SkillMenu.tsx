import React from "react";
import type { Skill } from "./globalChatTypes";
import { Plug } from "lucide-react";
import { GLOBAL_CHAT_SKILL_IDS } from "../../../../skills";
import { stopNodePropagation } from "./stopPropagation";

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
export const SkillMenu: React.FC<SkillMenuProps> = ({
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
