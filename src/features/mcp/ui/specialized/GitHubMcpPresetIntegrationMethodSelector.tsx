import React from "react";
import { Terminal } from "lucide-react";
import { GITHUB_PRESETS } from "../../service/githubConfig";
import type { GitHubIntegrationMethod } from "../../service/specializedTypes";
import styles from "./SpecializedMcp.module.css";
import type { GitHubMcpModel } from "./useGitHubMcp";

export function GitHubMcpPresetIntegrationMethodSelector({ model }: { model: GitHubMcpModel }): React.ReactElement {
  const { formData, handleFieldChange } = model;
  const activePreset = GITHUB_PRESETS.find((preset) => preset.id === formData.method);

  return (
    <>
      {/* Preset Integration Method Selector */}
      <div className={styles.section}>
        <h4 className={styles.sectionTitle}>
          <Terminal size={15} />
          <span>Integration Method</span>
        </h4>
        <div className={styles.presetGrid}>
          {GITHUB_PRESETS.map((preset) => {
            const isActive = formData.method === preset.id;
            const PresetIcon = preset.icon;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleFieldChange("method", preset.id as GitHubIntegrationMethod)}
                aria-pressed={isActive}
                className={`${styles.presetCard} ${isActive ? styles.presetCardActive : ""}`}
              >
                <div>
                  <div className={styles.presetTop}>
                    <div className={styles.presetNameRow}>
                      <span className={styles.presetIconWrap}>
                        <PresetIcon size={13} />
                      </span>
                      <span className={styles.presetName}>{preset.name}</span>
                    </div>
                    <span className={styles.presetBadge}>{preset.badge}</span>
                  </div>
                  <p className={styles.presetDesc}>{preset.description}</p>
                </div>
              </button>
            );
          })}
        </div>
        {activePreset && (
          <div className={styles.presetCommand} title={activePreset.commandPreview}>
            <Terminal size={13} aria-hidden="true" />
            <code className={styles.presetCommandText}>{activePreset.commandPreview}</code>
          </div>
        )}
      </div>
    </>
  );
}
