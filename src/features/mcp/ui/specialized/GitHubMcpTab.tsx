import React from "react";
import styles from "./SpecializedMcp.module.css";
import { GitHubMcpHeaderCard } from "./GitHubMcpHeaderCard";
import { GitHubMcpPresetIntegrationMethodSelector } from "./GitHubMcpPresetIntegrationMethodSelector";
import { GitHubMcpConnectionForm } from "./GitHubMcpConnectionForm";
import { GitHubMcpGuideCallout } from "./GitHubMcpGuideCallout";
import { useGitHubMcp } from "./useGitHubMcp";

export const GitHubMcpTab: React.FC = () => {
  const model = useGitHubMcp();

  return (
    <div className={styles.container}>
      <GitHubMcpHeaderCard model={model} />
      <GitHubMcpPresetIntegrationMethodSelector model={model} />
      <GitHubMcpConnectionForm model={model} />
      <GitHubMcpGuideCallout model={model} />
    </div>
  );
};
