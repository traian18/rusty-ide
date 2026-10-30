import React from "react";
import styles from "./SpecializedMcp.module.css";
import { AtlassianMcpHeaderCard } from "./AtlassianMcpHeaderCard";
import { AtlassianMcpPresetIntegrationMethodSelector } from "./AtlassianMcpPresetIntegrationMethodSelector";
import { AtlassianMcpConnectionForm } from "./AtlassianMcpConnectionForm";
import { AtlassianMcpGuideCallout } from "./AtlassianMcpGuideCallout";
import { useAtlassianMcp } from "./useAtlassianMcp";

export const AtlassianMcpTab: React.FC = () => {
  const model = useAtlassianMcp();

  return (
    <div className={styles.container}>
      <AtlassianMcpHeaderCard model={model} />
      <AtlassianMcpPresetIntegrationMethodSelector model={model} />
      <AtlassianMcpConnectionForm model={model} />
      <AtlassianMcpGuideCallout model={model} />
    </div>
  );
};
