import React, { useState, useEffect } from "react";
import { Folder, Trash2, RefreshCw, X, ChevronRight, ChevronDown } from "lucide-react";
import { VfsRegistry, VFS_CHANGED_EVENT, NodeFilesEntry } from "../../../services/vfs";
import { useWorkspaceStore } from "../../../store";
import { RECONCILIATION_NODE_PREFIX } from "../../../services/reconciliationService";
import { focusCanvasNode } from "../../../services/canvasNodeNavigation";

interface VfsExplorerProps {
  onClose?: () => void;
  tabId?: string;
}

export const VfsExplorer: React.FC<VfsExplorerProps> = ({ onClose, tabId }) => {
  const [nodeFiles, setNodeFiles] = useState<NodeFilesEntry[]>([]);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadNodeFiles = async () => {
    setLoading(true);
    try {
      const files = await VfsRegistry.getOrCreate(tabId).getAllNodeFiles();
      setNodeFiles(files);
    } catch (err) {
      console.error(`[VfsExplorer] Failed to load node files:`, err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNodeFiles();
  }, [tabId]);

  useEffect(() => {
    const handleVfsChanged = (event: Event) => {
      const changedTabId = (event as CustomEvent<{ tabId: string }>).detail?.tabId;
      if (changedTabId === (tabId || "global")) {
        void loadNodeFiles();
      }
    };

    window.addEventListener(VFS_CHANGED_EVENT, handleVfsChanged);
    return () => window.removeEventListener(VFS_CHANGED_EVENT, handleVfsChanged);
  }, [tabId]);

  const toggleNode = (nodeId: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId);
    } else {
      newExpanded.add(nodeId);
    }
    setExpandedNodes(newExpanded);
  };

  const deleteNodeFiles = async (nodeId: string) => {
    try {
      await VfsRegistry.getOrCreate(tabId).deleteNodeFiles(nodeId);
      await loadNodeFiles();
    } catch (err) {
      console.error(`[VfsExplorer] Failed to delete node files:`, err);
    }
  };

  const deleteAllNodeFiles = async () => {
    try {
      for (const nf of nodeFiles) {
        await VfsRegistry.getOrCreate(tabId).deleteNodeFiles(nf.node_id);
      }
      await loadNodeFiles();
    } catch (err) {
      console.error(`[VfsExplorer] Failed to delete all node files:`, err);
    }
  };

  const getNodeName = (nodeId: string): string => {
    if (nodeId.startsWith(RECONCILIATION_NODE_PREFIX)) return "Reconciliation Ledger";
    const state = useWorkspaceStore.getState();
    if (tabId) {
      const canvasCtx = state.canvasContexts[tabId];
      if (canvasCtx) {
        const node = canvasCtx.nodes.find((n: any) => n.id === nodeId);
        if (node?.data?.name) return String(node.data.name);
      }
    }
    const topNode = state.nodes.find((n: any) => n.id === nodeId);
    if (topNode?.data?.name) return String(topNode.data.name);
    return nodeId.length > 12 ? `${nodeId.substring(0, 12)}...` : nodeId;
  };

  const getFileName = (path: string): string => {
    const parts = path.replace(/\\/g, "/").split("/");
    return parts[parts.length - 1] || path;
  };

  const getFileDir = (path: string): string => {
    const parts = path.replace(/\\/g, "/").split("/");
    parts.pop();
    return parts.join("/") || "/";
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-sidebar)] border-l border-[var(--border-color)]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-header)]">
        <div className="flex items-center space-x-2">
          <Folder size={14} className="text-[var(--color-status-warning)]" />
          <span className="text-xs font-semibold text-[var(--text-light)]">VFS Explorer</span>
          <span className="text-[10px] text-[var(--text-muted)]">({nodeFiles.length} nodes)</span>
        </div>
        <div className="flex items-center space-x-1">
          <button
            onClick={loadNodeFiles}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors"
            title="Refresh"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors"
              title="Close"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2">
        {nodeFiles.length === 0 ? (
          <div className="text-center text-[10px] text-[var(--text-muted)] py-8">
            No VFS files tracked yet.
            <br />
            <span className="text-[9px]">Files created by TaskNodes will appear here.</span>
          </div>
        ) : (
          <div className="space-y-1">
            {nodeFiles.map((nf) => {
              const isExpanded = expandedNodes.has(nf.node_id);
              const nodeName = getNodeName(nf.node_id);
              const canvasNode = tabId
                ? useWorkspaceStore.getState().canvasContexts[tabId]?.nodes.find((node: any) => node.id === nf.node_id)
                : undefined;
              const isNavigableTask = canvasNode?.type === "taskNode";
              const isNodePresent = nf.node_id.startsWith(RECONCILIATION_NODE_PREFIX)
                || (tabId ? useWorkspaceStore.getState().canvasContexts[tabId]?.nodes.some((n: any) => n.id === nf.node_id) : false)
                || useWorkspaceStore.getState().nodes.some((n: any) => n.id === nf.node_id);
              return (
                <div key={nf.node_id} className="border border-[var(--border-color)] rounded-lg overflow-hidden">
                  {/* Node header */}
                  <div className={`flex items-center justify-between px-2 py-1.5 transition-colors ${
                    !isNodePresent
                      ? "bg-[var(--color-status-danger-bg)]"
                      : selectedNodeId === nf.node_id
                      ? "bg-[var(--accent-bg)] border-l-2 border-[var(--accent-color)]"
                      : "bg-[var(--bg-app)]"
                  }`}>
                    <div
                      className={`flex items-center space-x-1.5 flex-1 min-w-0 ${isNavigableTask ? "cursor-pointer" : ""}`}
                      onClick={() => isNavigableTask && setSelectedNodeId(nf.node_id)}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        if (tabId && isNavigableTask) focusCanvasNode(tabId, nf.node_id);
                      }}
                      title={isNavigableTask ? "Click to select; double-click to jump to this Task Node" : undefined}
                    >
                      <button
                        onClick={() => toggleNode(nf.node_id)}
                        className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-light)] flex-shrink-0"
                      >
                        {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                      </button>
                      <Folder size={11} className="text-[var(--color-status-warning)] flex-shrink-0" />
                      <span className="text-[10px] font-medium text-[var(--text-light)] truncate" title={nf.node_id}>
                        {nodeName}
                      </span>
                      {isNavigableTask && selectedNodeId === nf.node_id && (
                        <span className="text-[8px] text-[var(--accent-color)] flex-shrink-0">double-click to jump</span>
                      )}
                      {!isNodePresent && (
                        <span className="text-[8px] px-1 py-0.5 bg-[var(--color-status-danger-bg)] text-[var(--color-status-danger)] rounded flex-shrink-0">deleted</span>
                      )}
                    </div>
                    <div className="flex items-center space-x-1 flex-shrink-0 ml-2">
                      <span className="text-[9px] text-[var(--text-muted)]">{nf.files.length} files</span>
                      <button
                        onClick={() => deleteNodeFiles(nf.node_id)}
                        className="p-1 text-[var(--color-status-danger)] hover:text-[var(--color-status-danger)] transition-colors"
                        title="Delete all files for this node"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </div>
                  {/* File list */}
                  {isExpanded && (
                    <div className="bg-[var(--bg-sidebar)] border-t border-[var(--border-color)]">
                      {nf.files.map((filePath, idx) => (
                        <div key={idx} className="flex items-center justify-between px-3 py-1 pl-6 border-b border-[var(--border-color)]/50 last:border-b-0">
                          <div className="flex flex-col min-w-0">
                            <span className="text-[9px] font-medium text-[var(--text-normal)] truncate" title={filePath}>
                              {getFileName(filePath)}
                            </span>
                            <span className="text-[8px] text-[var(--text-muted)] truncate" title={getFileDir(filePath)}>
                              {getFileDir(filePath)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      {nodeFiles.length > 0 && (
        <div className="px-3 py-2 border-t border-[var(--border-color)]">
          <button
            onClick={deleteAllNodeFiles}
            className="w-full text-[10px] font-medium text-[var(--color-status-danger)] hover:text-[var(--color-status-danger)] py-1.5 px-2 rounded border border-[var(--color-status-danger-border)] hover:border-[var(--color-status-danger-border)] transition-colors flex items-center justify-center space-x-1.5"
          >
            <Trash2 size={10} />
            <span>Delete All VFS Files</span>
          </button>
        </div>
      )}
    </div>
  );
};
