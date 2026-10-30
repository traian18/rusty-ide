import React from "react";
import { Terminal } from "lucide-react";
import { ATLASSIAN_PRESETS } from "../../service/atlassianConfig";
import type { AtlassianIntegrationMethod } from "../../service/specializedTypes";
import styles from "./SpecializedMcp.module.css";
import type { AtlassianMcpModel } from "./useAtlassianMcp";

export function AtlassianMcpPresetIntegrationMethodSelector({ model }: { model: AtlassianMcpModel }): React.ReactElement {
  const { formData, handleFieldChange } = model;

  return (
    <>
      {/* Preset Integration Method Selector */}
      <div className={styles.section}>
        <h4 className={styles.sectionTitle}>
          <Terminal size={15} />
          <span>Integration Method</span>
        </h4>
        <div className={styles.presetGrid}>
          {ATLASSIAN_PRESETS.map((preset) => {
            const isActive = formData.method === preset.id;
            const PresetIcon = preset.icon;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleFieldChange("method", preset.id as AtlassianIntegrationMethod)}
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
                <div className={styles.presetCodeRow} title={preset.commandPreview}>
                  <Terminal size={11} className={styles.presetCodeIcon} />
                  <span className={styles.presetCode}>{preset.commandPreview}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
