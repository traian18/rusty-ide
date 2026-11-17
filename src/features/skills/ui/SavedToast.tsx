import React from "react";
import { Save } from "lucide-react";
import type { SkillsTabModel } from "./useSkillsTab";
import styles from "./SkillsTab.module.css";

export function SavedToast({ model }: { model: SkillsTabModel }): React.ReactElement {
  const { showSavedModal } = model;

  return (
    <>
      {showSavedModal && (
        <div className={styles.toast} role="status">
          <Save size={15} aria-hidden="true" />
          <span>Changes have been saved</span>
        </div>
      )}
    </>
  );
}
