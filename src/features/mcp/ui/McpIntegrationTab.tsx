import React, { useState } from "react";
import { FolderOpen, Plug } from "lucide-react";
import { WorkspaceMcpScope } from "./WorkspaceMcpScope";
import { useWorkspaceStore } from "../../../store";
import { GitHubIcon, AtlassianIcon } from "./specialized/icons";
import { GitHubMcpTab } from "./specialized/GitHubMcpTab";
import { AtlassianMcpTab } from "./specialized/AtlassianMcpTab";
import { GenericMcpTab } from "./specialized/GenericMcpTab";
import type { McpTabKey } from "../service/specializedTypes";
import { SecretStorageStatus } from "../../settings/ui";
import { PageShell } from "../../../lib/ui";
import styles from "./McpIntegrationTab.module.css";

export const McpIntegrationTab: React.FC = () => {
  const mcpServers = useWorkspaceStore((state) => state.mcpServers);
  const rootPath = useWorkspaceStore((state) => state.rootPath);
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

  const presetStatus = (configured: boolean, enabled: boolean): NavStatus =>
    !configured ? { kind: "setup" } : enabled ? { kind: "connected" } : { kind: "disabled" };

  return (
    <PageShell
      icon={<Plug size={18} />}
      title="Model Context Protocol (MCP) Integrations"
      description="Connect specialized MCP tool servers to empower Rusty agents with external services, issue trackers, and developer APIs."
      headerExtra={<SecretStorageStatus />}
    >

        {rootPath ? (
          <>
            <WorkspaceMcpScope rootPath={rootPath} />
            <div className={styles.layout}>
              <nav className={styles.nav} aria-label="MCP integrations">
                <NavItem active={activeTab === "github"} onClick={() => setActiveTab("github")} icon={<GitHubIcon size={15} />} label="GitHub" status={presetStatus(hasGithub, isGithubEnabled)} />
                <NavItem active={activeTab === "atlassian"} onClick={() => setActiveTab("atlassian")} icon={<AtlassianIcon size={15} />} label="Atlassian (Jira & Confluence)" status={presetStatus(hasAtlassian, isAtlassianEnabled)} />
                <NavItem active={activeTab === "generic"} onClick={() => setActiveTab("generic")} icon={<Plug size={15} />} label="Generic / Custom Servers" status={{ kind: "count", count: servers.length }} />
              </nav>
              <div className={styles.panelArea}>
                {activeTab === "github" && <GitHubMcpTab />}
                {activeTab === "atlassian" && <AtlassianMcpTab />}
                {activeTab === "generic" && <GenericMcpTab onSelectTab={setActiveTab} />}
              </div>
            </div>
          </>
        ) : (
          <div className={styles.empty}>
            <h3 className={styles.emptyTitle}>
              <FolderOpen size={16} className={styles.titleIcon} />
              Open a workspace to set up MCP servers
            </h3>
            <p className={styles.emptyText}>
              MCP servers belong to a workspace: each workspace has its own, and only the open workspace's servers are available to its chats and runs.
            </p>
          </div>
        )}
    </PageShell>
  );
};

type NavStatus = { kind: "setup" | "connected" | "disabled" } | { kind: "count"; count: number };

function NavItem({ active, onClick, icon, label, status }: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  status: NavStatus;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}
      title={label}
    >
      {icon}
      <span className={styles.navLabel}>{label}</span>
      <NavStatusMark status={status} />
    </button>
  );
}

function NavStatusMark({ status }: { status: NavStatus }) {
  if (status.kind === "count") return <span className={`${styles.navStatus} ${styles.navCount}`}>{status.count}</span>;
  if (status.kind === "setup") return <span className={styles.navStatus}>Setup</span>;
  const label = status.kind === "connected" ? "Connected" : "Disabled";
  return (
    <span className={`${styles.navStatus} ${status.kind === "connected" ? styles.statusConnected : styles.statusDisabled}`} title={label}>
      <span className={styles.dot} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
