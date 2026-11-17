import React from "react";
import { Plus, Trash2 } from "lucide-react";
import type { SkillsTabModel } from "./useSkillsTab";
import styles from "./SkillsTab.module.css";

export function SkillsList({ model }: { model: SkillsTabModel }): React.ReactElement {
  const { skills, selectedSkillId, setSelectedSkillId, handleNewSkill, handleDelete } = model;

  return (
    <div className={styles.listColumn}>
      <div className={styles.listHeader}>
        <h3 className={styles.listTitle}>Skills</h3>
        <button type="button" onClick={handleNewSkill} className={styles.newButton}>
          <Plus size={14} />
          <span>New</span>
        </button>
      </div>

      <ul className={styles.list} aria-label="Skills">
        {skills.filter((skill) => !skill.isInternal).map((skill) => {
          const isSelected = skill.id === selectedSkillId;
          return (
            <li key={skill.id}>
              <div
                role="button"
                tabIndex={0}
                aria-current={isSelected ? "true" : undefined}
                onClick={() => setSelectedSkillId(skill.id)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedSkillId(skill.id);
                  }
                }}
                className={`${styles.item} ${isSelected ? styles.itemActive : ""}`}
              >
                <span className={styles.itemText}>
                  <span className={styles.itemNameRow}>
                    <span className={styles.itemName}>{skill.name}</span>
                    {skill.isBuiltIn && <span className={styles.itemTag}>Built-in</span>}
                  </span>
                  <span className={styles.itemDesc}>{skill.description || "No description"}</span>
                </span>
                {!skill.isBuiltIn && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(skill.id);
                    }}
                    className={styles.deleteButton}
                    title={`Delete ${skill.name}`}
                    aria-label={`Delete ${skill.name}`}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
