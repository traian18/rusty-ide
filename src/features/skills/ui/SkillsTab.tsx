import React from "react";
import { Cpu } from "lucide-react";
import { SkillsList } from "./SkillsList";
import { SkillEditor } from "./SkillEditor";
import { SavedToast } from "./SavedToast";
import { useSkillsTab } from "./useSkillsTab";

export const SkillsTab: React.FC = () => {
  const model = useSkillsTab();

  return (
    <div className="w-full h-full p-8 max-w-5xl mx-auto flex flex-col space-y-6 font-sans text-[var(--text-normal)] overflow-y-auto">
      <div className="flex flex-col space-y-1">
        <h2 className="text-2xl font-bold text-[var(--text-light)] flex items-center space-x-2">
          <Cpu className="text-[var(--accent-color)]" size={24} />
          <span>Skills</span>
        </h2>
        <p className="text-xs text-[var(--text-muted)] font-mono">
          Design AI agent behaviors and generate skill specs with a model.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-8">
        <SkillsList model={model} />

        <SkillEditor model={model} />
      </div>

      <SavedToast model={model} />
    </div>
  );
};
