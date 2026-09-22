import React, { useState, memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { Plug, Pencil, Check, Trash2, ChevronDown } from "lucide-react";
import { useWorkspaceStore } from "../../store";
import styles from "./McpNode.module.css";

export const McpNode: React.FC<{ id: string; data: any }> = memo(({ id, data }) => {
  const updateNode = useWorkspaceStore((state) => state.updateTaskNode);
  const deleteNode = useWorkspaceStore((state) => state.deleteNode);
  const mcpServers = useWorkspaceStore((state) => state.mcpServers);
  const [isEditing, setIsEditing] = useState(false);
  const [tempName, setTempName] = useState(data.name || "MCP Context");
  const [menuOpen, setMenuOpen] = useState(false);

  const serverNames = Object.keys(mcpServers);
  const selectedServer = data.mcpServerName ? mcpServers[data.mcpServerName] : null;

  const handleNameSave = () => {
    updateNode(id, { name: tempName });
    setIsEditing(false);
  };

  const handleSelectServer = (name: string) => {
    updateNode(id, { mcpServerName: name });
    setMenuOpen(false);
  };

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateNode(id, { description: e.target.value });
  };

  return (
    <div className={styles.node}>
      {/* Node Header (Draggable surface) */}
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <Plug size={14} className={styles.infoIcon} />
          {isEditing ? (
            <input
              type="text"
              value={tempName}
              onChange={(e) => setTempName(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleNameSave();
                if (e.key === "Escape") setIsEditing(false);
              }}
              className={`nodrag ${styles.nameInput}`}
              autoFocus
            />
          ) : (
            <span className={styles.title}>
              {data.name || "MCP Context"}
            </span>
          )}
        </div>

        <div className={styles.actions}>
          {isEditing ? (
            <button
              onClick={handleNameSave}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className={`nodrag ${styles.actionButton} ${styles.saveButton}`}
            >
              <Check size={13} />
            </button>
          ) : (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                className={`nodrag ${styles.actionButton}`}
                title="Rename node"
              >
                <Pencil size={12} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); deleteNode(id); }}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                className={`nodrag ${styles.actionButton} ${styles.deleteButton}`}
                title="Delete node"
              >
                <Trash2 size={12} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Node Content */}
      <div className={styles.content}>
        {/* MCP Server Selector */}
        <div>
          <label className={styles.label}>
            MCP Server
          </label>
          <div className={styles.selector}>
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className={`nodrag ${styles.selectorButton}`}
            >
              <span className={selectedServer ? styles.selectedText : styles.placeholder}>
                {selectedServer ? (selectedServer.displayName || selectedServer.name) : "Select MCP server..."}
              </span>
              <ChevronDown size={13} className={styles.chevron} />
            </button>
            {menuOpen && (
              <div
                className={styles.menu}
                onClick={(e) => e.stopPropagation()}
              >
                {serverNames.length === 0 ? (
                  <div className={styles.empty}>
                    No servers configured. Add one in MCP Integration.
                  </div>
                ) : (
                  serverNames.map((name) => {
                    const srv = mcpServers[name];
                    return (
                      <button
                        key={name}
                        onClick={(e) => { e.stopPropagation(); handleSelectServer(name); }}
                        onPointerDown={(e) => e.stopPropagation()}
                        className={styles.menuItem}
                      >
                        <span className={styles.truncate}>{srv.displayName || srv.name}</span>
                        <span className={`${styles.transport} ${srv.enabled ? styles.enabled : ""}`}>
                          {srv.transport.type}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
          {selectedServer && (
            <div className={styles.serverDetail}>
              {selectedServer.transport.url || selectedServer.transport.command}
              {!selectedServer.enabled && " · disabled"}
            </div>
          )}
        </div>

        {/* Description / fetch intent */}
        <div>
          <label className={styles.label}>
            Fetch Description
          </label>
          <textarea
            value={data.description || ""}
            onChange={handleDescriptionChange}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            placeholder="What should the LLM fetch from this MCP server?"
            className={`nodrag ${styles.description}`}
            rows={2}
          />
        </div>
      </div>

      {/* Handles — same as ContextNode so it wires into task nodes */}
      <Handle
        type="source"
        position={Position.Top}
        id="context-out-top"
        style={{ background: "var(--color-status-info-solid)", width: 14, height: 14, border: "2.5px solid var(--color-surface-sidebar)" }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="context-out-bottom"
        style={{ background: "var(--color-status-info-solid)", width: 14, height: 14, border: "2.5px solid var(--color-surface-sidebar)" }}
      />
    </div>
  );
});
