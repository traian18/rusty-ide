import React, { useState } from "react";
import { Plus, Pencil, Trash2, Power } from "lucide-react";
import type { McpServerConfig, TransportType, AuthType } from "../../model";
import { McpIntegrationModal } from "../McpIntegrationModal";
import { useWorkspaceStore } from "../../../../store";
import { GitHubIcon, AtlassianIcon } from "./icons";
import type { McpTabKey } from "../../service/specializedTypes";
import styles from "./SpecializedMcp.module.css";

const TRANSPORT_LABEL: Record<TransportType, string> = {
  http: "HTTP",
  sse: "SSE",
  websocket: "WebSocket",
  stdio: "Stdio",
};

const AUTH_LABEL: Record<AuthType, string> = {
  none: "No auth",
  apiKey: "API Key",
  bearer: "Bearer",
  oauth2: "OAuth 2.0",
};

interface EditingState {
  name?: string;
  server?: McpServerConfig;
}

interface GenericMcpTabProps {
  onSelectTab?: (tab: McpTabKey) => void;
}

export const GenericMcpTab: React.FC<GenericMcpTabProps> = ({ onSelectTab }) => {
  const mcpServers = useWorkspaceStore((state) => state.mcpServers);
  const addMcpServer = useWorkspaceStore((state) => state.addMcpServer);
  const updateMcpServer = useWorkspaceStore((state) => state.updateMcpServer);
  const removeMcpServer = useWorkspaceStore((state) => state.removeMcpServer);
  const [editing, setEditing] = useState<EditingState | null>(null);

  const servers = Object.values(mcpServers);

  const handleAdd = () => setEditing({});
  const handleEdit = (server: McpServerConfig) =>
    setEditing({ name: server.name, server });
  const handleCancel = () => setEditing(null);

  const handleSave = (cfg: McpServerConfig) => {
    if (editing?.name && editing.name !== cfg.name) {
      removeMcpServer(editing.name);
    }
    addMcpServer(cfg);
    setEditing(null);
  };

  const handleDelete = (name: string) => {
    removeMcpServer(name);
  };

  const toggleEnabled = (name: string) => {
    const existing = mcpServers[name];
    if (!existing) return;
    updateMcpServer(name, { enabled: !existing.enabled });
  };

  const existingNames = Object.keys(mcpServers).filter(
    (n) => n !== editing?.name
  );

  const getServerBadge = (server: McpServerConfig) => {
    const lowerName = server.name.toLowerCase();
    const lowerDisplay = (server.displayName || "").toLowerCase();
    if (lowerName.includes("github") || lowerDisplay.includes("github")) {
      return {
        label: "GitHub",
        icon: <GitHubIcon size={12} />,
        tab: "github" as McpTabKey,
      };
    }
    if (lowerName.includes("atlassian") || lowerDisplay.includes("atlassian") || lowerName.includes("jira")) {
      return {
        label: "Atlassian",
        icon: <AtlassianIcon size={12} />,
        tab: "atlassian" as McpTabKey,
      };
    }
    return null;
  };

  return (
    <div className={styles.container}>
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h3 className={styles.sectionTitle}>Configured servers</h3>
            <p className={styles.description}>Manage custom stdio or HTTP Model Context Protocol servers.</p>
          </div>
          <button type="button" onClick={handleAdd} className={styles.buttonPrimary}>
            <Plus size={14} />
            <span>Add Custom Server</span>
          </button>
        </div>

        {servers.length === 0 ? (
          <div className={styles.emptyState}>
            <div>
              <p className={styles.serverName}>No MCP servers configured yet</p>
              <p className={styles.description}>
                Add a custom server using stdio or HTTP, or use the dedicated GitHub and Atlassian integrations for quick configuration.
              </p>
            </div>
            {onSelectTab && (
              <div className={styles.emptyActions}>
                <button type="button" onClick={() => onSelectTab("github")} className={styles.buttonSecondary}>
                  <GitHubIcon size={13} />
                  <span>Setup GitHub</span>
                </button>
                <button type="button" onClick={() => onSelectTab("atlassian")} className={styles.buttonSecondary}>
                  <AtlassianIcon size={13} />
                  <span>Setup Atlassian</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <ul className={styles.serverList}>
            {servers.map((server) => {
              const badge = getServerBadge(server);
              return (
                <li key={server.name} className={`${styles.serverRow} ${server.enabled ? "" : styles.serverDisabled}`}>
                  <div className={styles.serverMain}>
                    <div className={styles.serverNameRow}>
                      <span className={styles.serverName}>{server.displayName || server.name}</span>
                      <span className={styles.serverId}>{server.name}</span>
                      {badge && (
                        <button
                          type="button"
                          onClick={() => onSelectTab?.(badge.tab)}
                          className={styles.serverLink}
                          title={`Open specialized ${badge.label} tab`}
                        >
                          {badge.icon}
                          <span>{badge.label}</span>
                        </button>
                      )}
                    </div>
                    <span className={styles.serverMeta}>
                      {TRANSPORT_LABEL[server.transport.type]}
                      {server.transport.url ? ` · ${server.transport.url}` : ""}
                      {server.transport.command ? ` · ${server.transport.command} ${(server.transport.args || []).join(" ")}` : ""}
                      {" · "}
                      {AUTH_LABEL[server.auth.type]}
                    </span>
                  </div>

                  <div className={styles.serverActions}>
                    <button
                      type="button"
                      onClick={() => toggleEnabled(server.name)}
                      className={`${styles.iconButton} ${server.enabled ? styles.iconButtonOn : ""}`}
                      title={server.enabled ? "Disable server" : "Enable server"}
                      aria-pressed={server.enabled}
                    >
                      <Power size={14} />
                    </button>
                    <button type="button" onClick={() => handleEdit(server)} className={styles.iconButton} title="Edit configuration">
                      <Pencil size={14} />
                    </button>
                    <button type="button" onClick={() => handleDelete(server.name)} className={`${styles.iconButton} ${styles.iconButtonDanger}`} title="Delete server">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className={styles.footnote}>
        Servers are saved encrypted in Rusty's configuration, for this workspace only. All registered tools are automatically discoverable by agents and task nodes.
      </p>

      {editing && (
        <McpIntegrationModal
          initialConfig={editing.server}
          existingNames={existingNames}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      )}
    </div>
  );
};
