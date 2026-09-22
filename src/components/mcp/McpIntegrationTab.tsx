import React, { useState } from "react";
import { Plug, Plus, Pencil, Trash2, Power } from "lucide-react";
import { McpServerConfig, TransportType, AuthType } from "./types";
import { McpIntegrationModal } from "./McpIntegrationModal";
import { useWorkspaceStore } from "../../store";

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

export const McpIntegrationTab: React.FC = () => {
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

  return (
    <div className="w-full h-full p-8 max-w-5xl mx-auto flex flex-col space-y-6 font-sans text-[var(--text-normal)] overflow-y-auto">
      <div className="flex flex-col space-y-1">
        <h2 className="text-2xl font-bold text-[var(--text-light)] flex items-center space-x-2">
          <Plug className="text-[var(--accent-color)]" size={24} />
          <span>MCP Integration</span>
        </h2>
        <p className="text-xs text-[var(--text-muted)] font-mono">
          Configure Model Context Protocol servers. Settings persist to a{" "}
          <span className="text-[var(--accent-color)]">mcpServers</span> config object.
        </p>
      </div>

      <div className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider font-mono">
            Configured Servers ({servers.length})
          </h3>
          <button
            onClick={handleAdd}
            className="flex items-center space-x-1 text-[10px] font-bold text-[var(--accent-color)] hover:text-[var(--text-light)] transition-colors px-2 py-1 rounded-lg hover:bg-[var(--accent-bg)]"
          >
            <Plus size={12} />
            <span>Add Server</span>
          </button>
        </div>

        <div className="space-y-2">
          {servers.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 space-y-3 text-center">
              <Plug size={28} className="text-[var(--text-muted)]" />
              <p className="text-xs text-[var(--text-muted)] font-mono">
                No MCP servers configured yet.
              </p>
              <button
                onClick={handleAdd}
                className="flex items-center space-x-2 px-4 py-2 bg-[var(--accent-color)] hover:bg-[var(--accent-color)]/80 text-[var(--color-primary-foreground)] text-xs font-bold rounded-lg transition-colors"
              >
                <Plus size={14} />
                <span>Add Server</span>
              </button>
            </div>
          )}

          {servers.map((server) => (
            <div
              key={server.name}
              className="group flex items-center justify-between p-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-app)]/50 hover:border-[var(--border-active)] transition-all"
            >
              <div className="flex flex-col min-w-0 pr-2">
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-bold text-[var(--text-light)]">
                    {server.displayName || server.name}
                  </span>
                  <span className="text-[9px] font-mono text-[var(--text-muted)] bg-[var(--bg-app)] border border-[var(--border-color)] px-1.5 py-0.5 rounded">
                    {server.name}
                  </span>
                </div>
                <span className="text-[10px] text-[var(--text-muted)] font-mono truncate mt-0.5">
                  {TRANSPORT_LABEL[server.transport.type]}
                  {server.transport.url ? ` · ${server.transport.url}` : ""}
                  {server.transport.command ? ` · ${server.transport.command}` : ""}
                  {" · "}
                  {AUTH_LABEL[server.auth.type]}
                </span>
              </div>

              <div className="flex items-center space-x-2 flex-shrink-0">
                <button
                  onClick={() => toggleEnabled(server.name)}
                  className={`p-1.5 rounded-lg transition-colors ${
                    server.enabled
                      ? "text-[var(--color-status-success)] hover:bg-[var(--color-status-success-bg)]"
                      : "text-[var(--text-muted)] hover:bg-[var(--accent-bg)]"
                  }`}
                  title={server.enabled ? "Disable" : "Enable"}
                >
                  <Power size={14} />
                </button>
                <button
                  onClick={() => handleEdit(server)}
                  className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--accent-color)] hover:bg-[var(--accent-bg)] transition-colors"
                  title="Edit"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => handleDelete(server.name)}
                  className="p-1.5 rounded-lg text-[var(--color-status-danger)] hover:text-[var(--color-status-danger)] hover:bg-[var(--color-status-danger-bg)] transition-colors"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl p-4">
        <p className="text-[10px] text-[var(--text-muted)] font-mono leading-relaxed">
          Persisted shape:{" "}
          <span className="text-[var(--accent-color)]">
            {"{ mcpServers: { [name]: { transport, auth, timeout, ... } } }"}
          </span>
          . Wire <span className="text-[var(--accent-color)]">onSave</span> into your
          app's config store — see <span className="text-[var(--accent-color)]">src/components/mcp/README.md</span>.
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
