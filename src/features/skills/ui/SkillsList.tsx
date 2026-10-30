import React from "react";
import { Plus, Trash2 } from "lucide-react";
import type { SkillsTabModel } from "./useSkillsTab";

export function SkillsList({ model }: { model: SkillsTabModel }): React.ReactElement {
  const { skills, selectedSkillId, setSelectedSkillId, handleNewSkill, handleDelete } = model;

  return (
    <>
        <div className="md:col-span-2 space-y-4">
          <div className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">
                Skills
              </h3>
              <button
                onClick={handleNewSkill}
                className="flex items-center space-x-1 text-[10px] font-bold text-[var(--accent-color)] hover:text-[var(--text-light)] transition-colors px-2 py-1 rounded-lg hover:bg-[var(--accent-bg)]"
              >
                <Plus size={12} />
                <span>New</span>
              </button>
            </div>

            <div className="space-y-2">
              {skills.filter((skill) => !skill.isInternal).map((skill) => {
                const isSelected = skill.id === selectedSkillId;
                return (
                  <div
                    key={skill.id}
                    onClick={() => setSelectedSkillId(skill.id)}
                    className={`group flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${
                      isSelected
                        ? "border-[var(--accent-color)] bg-[var(--accent-bg)]/20 shadow-[0_0_10px_var(--color-focus-ring)]"
                        : "border-[var(--border-color)] bg-[var(--bg-app)]/50 hover:bg-[var(--bg-sidebar)] hover:border-[var(--border-active)]"
                    }`}
                  >
                    <div className="flex flex-col min-w-0 pr-2">
                      <span className="text-xs font-bold text-[var(--text-light)] group-hover:text-[var(--accent-color)] transition-colors">
                        {skill.name}
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)] font-mono line-clamp-2 mt-0.5">
                        {skill.description || "No description"}
                      </span>
                    </div>
                    <div className="flex items-center space-x-2 flex-shrink-0">
                      {skill.isBuiltIn && (
                        <span className="text-[8px] font-bold text-[var(--color-status-warning)] bg-[var(--color-status-warning-bg)] px-1.5 py-0.5 rounded-full">
                          Built-in
                        </span>
                      )}
                      {!skill.isBuiltIn && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(skill.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-[var(--color-status-danger)] hover:text-[var(--color-status-danger)]"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
    </>
  );
}
