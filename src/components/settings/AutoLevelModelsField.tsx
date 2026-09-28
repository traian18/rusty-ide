import React, { useMemo } from "react";
import { CustomSelect, type OptionGroup } from "../CustomSelect";
import {
  AUTO_LEVEL_CRITERIA,
  AUTO_LEVEL_LABELS,
  type IntelligentCandidate,
} from "../../services/intelligentModelSelector";
import { AUTO_LEVELS, type AutoLevel } from "../../store/intelligentModelSelectionTypes";
import styles from "./IntelligentModelSelectionSettings.module.css";

interface AutoLevelModelsFieldProps {
  /** Every model a level can run on. */
  available: IntelligentCandidate[];
  levelModels: Record<AutoLevel, string | null>;
  onChange: (level: AutoLevel, candidateId: string) => void;
}

export const AutoLevelModelsField: React.FC<AutoLevelModelsFieldProps> = ({ available, levelModels, onChange }) => {
  const groups = useMemo<OptionGroup[]>(() => {
    const byProvider = new Map<string, OptionGroup>();
    for (const candidate of available) {
      const group = byProvider.get(candidate.provider.id) ?? { label: candidate.provider.name, options: [] };
      group.options.push({ id: candidate.id, name: candidate.model.name });
      byProvider.set(candidate.provider.id, group);
    }
    return [...byProvider.values()];
  }, [available]);
  const availableIds = useMemo(() => new Set(available.map((candidate) => candidate.id)), [available]);

  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>Model per level</span>
      <p className={styles.fieldHint}>
        JEV rates how demanding each request is; the level's model then runs it. When JEV is unsure and leans
        towards a higher level, AUTO steps up one level.
      </p>
      <ol className={styles.levelList}>
        {AUTO_LEVELS.map((level) => {
          const selectedId = levelModels[level];
          const isUnavailable = Boolean(selectedId) && !availableIds.has(selectedId!);
          const selectId = `auto-level-model-${level}`;
          return (
            <li className={styles.levelRow} key={level}>
              <div className={styles.levelCopy}>
                <label className={styles.levelName} htmlFor={selectId}>{AUTO_LEVEL_LABELS[level]}</label>
                <p className={styles.levelDescription}>{AUTO_LEVEL_CRITERIA[level]}</p>
              </div>
              <div className={styles.levelControl}>
                <CustomSelect
                  id={selectId}
                  value={isUnavailable ? "" : selectedId || ""}
                  onChange={(candidateId) => onChange(level, candidateId)}
                  groups={groups}
                  placeholder={available.length ? "Choose a model" : "Connect a provider first"}
                />
                {isUnavailable && (
                  <p className={styles.levelWarning}>
                    {selectedId!.slice(selectedId!.indexOf(":") + 1)} is no longer available.
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
};
