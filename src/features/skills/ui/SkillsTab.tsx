import React from "react";
import { Cpu } from "lucide-react";
import { SkillsList } from "./SkillsList";
import { SkillEditor } from "./SkillEditor";
import { SavedToast } from "./SavedToast";
import { useSkillsTab } from "./useSkillsTab";
import { PageShell } from "../../../lib/ui";
import styles from "./SkillsTab.module.css";

export const SkillsTab: React.FC = () => {
  const model = useSkillsTab();

  return (
    <PageShell
      icon={<Cpu size={18} />}
      title="Skills"
      description="Design AI agent behaviors and generate skill specs with a model."
    >
      <div className={styles.layout}>
        <SkillsList model={model} />

        <SkillEditor model={model} />
      </div>

      <SavedToast model={model} />
    </PageShell>
  );
};
