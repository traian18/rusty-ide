import React, { useState } from "react";
import { Plug, Plus, Pencil, Trash2, Power } from "lucide-react";
import type { McpServerConfig, TransportType, AuthType } from "../types";
import { McpIntegrationModal } from "../McpIntegrationModal";
import { useWorkspaceStore } from "../../../store";
import { GitHubIcon, AtlassianIcon } from "./icons";
import type { McpTabKey } from "./types";

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
    <div className="flex flex-col space-y-5 w-full">
      <div className="bg-[var(--color-surface-app)] border border-[var(--color-border-default)] rounded-xl p-5 space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold text-[var(--color-fg-muted)] uppercase tracking-wider font-mono">
              Configured Servers ({servers.length})
            </h3>
            <p className="text-xs text-[var(--color-fg-muted)] mt-0.5">
              Manage custom stdio or HTTP Model Context Protocol servers.
            </p>
          </div>
          <button
            onClick={handleAdd}
            className="flex items-center space-x-1.5 text-xs font-bold text-[var(--color-surface-app)] bg-[var(--color-primary)] hover:brightness-110 transition-all px-3 py-1.5 rounded-lg cursor-pointer"
          >
            <Plus size={14} />
            <span>Add Custom Server</span>
          </button>
        </div>

        <div className="space-y-2.5">
          {servers.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 space-y-3 text-center border border-dashed border-[var(--color-border-default)] rounded-lg">
              <Plug size={32} className="text-[var(--color-fg-muted)] opacity-60" />
              <div className="space-y-1">
                <p className="text-xs font-semibold text-[var(--color-fg-strong)]">
                  No MCP servers configured yet
                </p>
                <p className="text-xs text-[var(--color-fg-muted)] max-w-sm">
                  Add a custom server using stdio or HTTP, or use the dedicated GitHub and Atlassian tabs above for quick configuration.
                </p>
              </div>
              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={handleAdd}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-[var(--color-primary)] text-[var(--color-surface-app)] text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  <Plus size={13} />
                  <span>Add Custom Server</span>
                </button>
                {onSelectTab && (
                  <>
                    <button
                      onClick={() => onSelectTab("github")}
                      className="flex items-center space-x-1.5 px-3 py-1.5 bg-[var(--color-surface-app)] border border-[var(--color-border-default)] hover:border-[var(--color-primary)] text-[var(--color-fg-default)] text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                    >
                      <GitHubIcon size={13} />
                      <span>Setup GitHub</span>
                    </button>
                    <button
                      onClick={() => onSelectTab("atlassian")}
                      className="flex items-center space-x-1.5 px-3 py-1.5 bg-[var(--color-surface-app)] border border-[var(--color-border-default)] hover:border-[var(--color-primary)] text-[var(--color-fg-default)] text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                    >
                      <AtlassianIcon size={13} />
                      <span>Setup Atlassian</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {servers.map((server) => {
            const badge = getServerBadge(server);
            return (
              <div
                key={server.name}
                className="group flex items-center justify-between p-3.5 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-app)] hover:border-[var(--color-border-focus)] transition-all shadow-sm"
              >
                <div className="flex flex-col min-w-0 pr-3">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold text-[var(--color-fg-strong)]">
                      {server.displayName || server.name}
                    </span>
                    <span className="text-[10px] font-mono text-[var(--color-fg-muted)] bg-[var(--color-surface-app)] border border-[var(--color-border-subtle)] px-1.5 py-0.5 rounded">
                      {server.name}
                    </span>
                    {badge && (
                      <button
                        type="button"
                        onClick={() => onSelectTab?.(badge.tab)}
                        className="inline-flex items-center gap-1 text-[9px] font-bold text-[var(--color-primary)] bg-[var(--color-surface-app)] border border-[var(--color-primary)] px-1.5 py-0.5 rounded cursor-pointer hover:brightness-110"
                        title={`Open specialized ${badge.label} tab`}
                      >
                        {badge.icon}
                        <span>{badge.label}</span>
                      </button>
                    )}
                  </div>
                  <span className="text-[11px] text-[var(--color-fg-muted)] font-mono truncate mt-1">
                    {TRANSPORT_LABEL[server.transport.type]}
                    {server.transport.url ? ` · ${server.transport.url}` : ""}
                    {server.transport.command ? ` · ${server.transport.command} ${(server.transport.args || []).join(" ")}` : ""}
                    {" · "}
                    {AUTH_LABEL[server.auth.type]}
                  </span>
                </div>

                <div className="flex items-center space-x-1.5 flex-shrink-0">
                  <button
                    onClick={() => toggleEnabled(server.name)}
                    className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                      server.enabled
                        ? "text-[var(--color-status-success)] hover:bg-[var(--color-status-success)]/10"
                        : "text-[var(--color-fg-muted)] hover:bg-[var(--color-border-default)]/20"
                    }`}
                    title={server.enabled ? "Disable server" : "Enable server"}
                  >
                    <Power size={14} />
                  </button>
                  <button
                    onClick={() => handleEdit(server)}
                    className="p-1.5 rounded-lg text-[var(--color-fg-muted)] hover:text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 transition-colors cursor-pointer"
                    title="Edit configuration"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(server.name)}
                    className="p-1.5 rounded-lg text-[var(--color-status-danger)] hover:bg-[var(--color-status-danger)]/10 transition-colors cursor-pointer"
                    title="Delete server"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-[var(--color-surface-app)] border border-[var(--color-border-default)] rounded-xl p-4">
        <p className="text-[11px] text-[var(--color-fg-muted)] font-mono leading-relaxed">
          Configuration persistence: Saved encrypted in{" "}
          <span className="text-[var(--color-primary)]">localStorage[&quot;rusty_secure_config&quot;]</span> under the{" "}
          <span className="text-[var(--color-primary)]">mcpServers</span> map. All registered tools are automatically discoverable by agents and task nodes.
        </p>
      </div>

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
