import React, { useState } from "react";
import { Plug } from "lucide-react";
import { useWorkspaceStore } from "../../store";
import { GitHubIcon, AtlassianIcon } from "./specialized/icons";
import { GitHubMcpTab } from "./specialized/GitHubMcpTab";
import { AtlassianMcpTab } from "./specialized/AtlassianMcpTab";
import { GenericMcpTab } from "./specialized/GenericMcpTab";
import type { McpTabKey } from "./specialized/types";
import { SecretStorageStatus } from "../settings/SecretStorageStatus";
import styles from "./specialized/SpecializedMcp.module.css";

export const McpIntegrationTab: React.FC = () => {
  const mcpServers = useWorkspaceStore((state) => state.mcpServers);
  const [activeTab, setActiveTab] = useState<McpTabKey>("github");

  const servers = Object.values(mcpServers);

  const hasGithub = Boolean(
    mcpServers.github ||
      servers.some((s) => s.name.toLowerCase().includes("github"))
  );
  const isGithubEnabled = Boolean(
    (mcpServers.github?.enabled ?? true) &&
      servers.some((s) => s.name.toLowerCase().includes("github") && s.enabled)
  );

  const hasAtlassian = Boolean(
    mcpServers.atlassian ||
      servers.some((s) => s.name.toLowerCase().includes("atlassian"))
  );
  const isAtlassianEnabled = Boolean(
    (mcpServers.atlassian?.enabled ?? true) &&
      servers.some((s) => s.name.toLowerCase().includes("atlassian") && s.enabled)
  );

  return (
    <div className="w-full h-full p-8 max-w-5xl mx-auto flex flex-col space-y-6 font-sans text-[var(--color-fg-default)] overflow-y-auto">
      {/* Top Main Header */}
      <div className="flex flex-col space-y-1">
        <h2 className="text-2xl font-bold text-[var(--color-fg-strong)] flex items-center space-x-2.5">
          <Plug className="text-[var(--color-primary)]" size={26} />
          <span>Model Context Protocol (MCP) Integrations</span>
        </h2>
        <p className="text-xs text-[var(--color-fg-muted)] font-mono">
          Connect specialized MCP tool servers to empower Rusty agents with external services, issue trackers, and developer APIs.
        </p>
        <SecretStorageStatus />
      </div>

      {/* Tab Navigation Bar */}
      <div className={styles.tabNav}>
        <button
          type="button"
          onClick={() => setActiveTab("github")}
          className={`${styles.tabNavButton} ${activeTab === "github" ? styles.tabNavButtonActive : ""}`}
        >
          <GitHubIcon size={16} />
          <span>GitHub</span>
          {hasGithub ? (
            <span className={`${styles.tabBadge} ${isGithubEnabled ? styles.badgeConnected : ""}`}>
              {isGithubEnabled ? "Connected" : "Disabled"}
            </span>
          ) : (
            <span className={styles.tabBadge}>Setup</span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("atlassian")}
          className={`${styles.tabNavButton} ${activeTab === "atlassian" ? styles.tabNavButtonActive : ""}`}
        >
          <AtlassianIcon size={16} />
          <span>Atlassian (Jira & Confluence)</span>
          {hasAtlassian ? (
            <span className={`${styles.tabBadge} ${isAtlassianEnabled ? styles.badgeConnected : ""}`}>
              {isAtlassianEnabled ? "Connected" : "Disabled"}
            </span>
          ) : (
            <span className={styles.tabBadge}>Setup</span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("generic")}
          className={`${styles.tabNavButton} ${activeTab === "generic" ? styles.tabNavButtonActive : ""}`}
        >
          <Plug size={16} />
          <span>Generic / Custom Servers</span>
          <span className={`${styles.tabBadge} ${activeTab === "generic" ? styles.tabBadgeActive : ""}`}>
            {servers.length}
          </span>
        </button>
      </div>

      {/* Tab Content Panel */}
      <div className="w-full">
        {activeTab === "github" && <GitHubMcpTab />}
        {activeTab === "atlassian" && <AtlassianMcpTab />}
        {activeTab === "generic" && <GenericMcpTab onSelectTab={setActiveTab} />}
      </div>
    </div>
  );
};
