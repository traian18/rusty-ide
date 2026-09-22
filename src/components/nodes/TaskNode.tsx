import React, { useState, useRef, useEffect, memo, useContext, useCallback } from "react";
import { Handle, Position } from "@xyflow/react";
import { Sparkles, AlertCircle, CheckCircle2, Loader2, Pencil, Check, Trash2, Octagon, Minimize2, Maximize2, Settings, Eye, EyeOff } from "lucide-react";
import { useWorkspaceStore } from "../../store";
import { CanvasTabContext } from "../tabs/canvas/CanvasTabContext";
import styles from "./TaskNode.module.css";

export const TaskNode: React.FC<{ id: string; data: any }> = memo(({ id, data }) => {
  const { tabId } = useContext(CanvasTabContext);
  const updateTaskNode = useWorkspaceStore((state) => state.updateTaskNode);
  const updateCanvasContext = useWorkspaceStore((state) => state.updateCanvasContext);
  const nodeStatus = useWorkspaceStore((state) => (state.canvasContexts[tabId] || { nodeStatus: {} }).nodeStatus[id] || "idle");
  const deleteNode = useWorkspaceStore((state) => state.deleteNode);
  const setSelectedNodeId = useWorkspaceStore((state) => state.setSelectedNodeId);

  // Context node reveal state
  const canvasContext = useWorkspaceStore((state) => state.canvasContexts[tabId]);
  const contextNodesHidden = canvasContext?.contextNodesHidden ?? false;
  const contextRevealedTasks = canvasContext?.contextRevealedTasks ?? [];
  const isContextRevealed = contextRevealedTasks.includes(id);

  const [isEditing, setIsEditing] = useState(false);
  const [tempName, setTempName] = useState(data.name || "AI Executor Node");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync temp name with data changes
  useEffect(() => {
    setTempName(data.name || "AI Executor Node");
  }, [data.name]);

  const isMinimized = data.isMinimized !== undefined ? data.isMinimized : true;
  const setIsMinimized = (val: boolean) => {
    updateTaskNode(id, { isMinimized: val });
  };

  // Toggle this task node's context reveal status
  const toggleContextReveal = useCallback(() => {
    const currentRevealed = useWorkspaceStore.getState().canvasContexts[tabId]?.contextRevealedTasks ?? [];
    const newRevealed = currentRevealed.includes(id)
      ? currentRevealed.filter((tid: string) => tid !== id)
      : [...currentRevealed, id];
    updateCanvasContext(tabId, { contextRevealedTasks: newRevealed });
  }, [tabId, id, updateCanvasContext]);

  // Auto-resize the prompt textarea based on content length
  useEffect(() => {
    if (textareaRef.current) {
      if (isMinimized) {
        textareaRef.current.style.height = "76px"; // Capped to roughly 3 rows
      } else {
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
      }
    }
  }, [data.prompt, isMinimized]);

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateTaskNode(id, { prompt: e.target.value });
  };

  const handleNameSave = () => {
    updateTaskNode(id, { name: tempName });
    setIsEditing(false);
  };

  // Get status configuration
  return (
    <div className={`${styles.node} ${nodeStatus === "idle" ? "" : styles[nodeStatus]}`}>
      {/* Node Header (Draggable surface) */}
      <div className={styles.header}>
        <div className={styles.headerMain}>
          <Sparkles size={14} className={`${styles.sparkle} ${nodeStatus === "running" ? styles.spinning : ""}`} />
          
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
            <span className={styles.name}>{data.name || "AI Executor Node"}</span>
          )}
        </div>
        
        <div className={styles.actions}>
          {/* Context reveal toggle — visible when context nodes are hidden */}
          {contextNodesHidden && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleContextReveal();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className={`nodrag ${styles.iconButton} ${isContextRevealed ? styles.positive : ""}`}
              title={isContextRevealed ? "Hide connected context nodes" : "Reveal connected context nodes"}
            >
              {isContextRevealed ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
          )}

          {isEditing ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleNameSave();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className={`nodrag ${styles.iconButton} ${styles.positive}`}
            >
              <Check size={14} />
            </button>
          ) : (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsMinimized(!isMinimized);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                className={`nodrag ${styles.iconButton}`}
                title={isMinimized ? "Expand instructions" : "Minimize instructions"}
              >
                {isMinimized ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditing(true);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                className={`nodrag ${styles.iconButton}`}
                title="Rename node"
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteNode(id);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                className={`nodrag ${styles.iconButton} ${styles.danger}`}
                title="Delete node"
              >
                <Trash2 size={14} />
              </button>
              {nodeStatus === "running" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    window.dispatchEvent(new CustomEvent("tasknode-stop-request", { detail: { nodeId: id } }));
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  className={`nodrag ${styles.iconButton} ${styles.danger}`}
                  title="Stop execution"
                >
                  <Octagon size={14} />
                </button>
              )}
            </>
          )}

          {/* Status indicator */}
          <div className={styles.status}>
            {nodeStatus === "running" && <Loader2 size={14} className={`${styles.runningIcon} ${styles.spinning}`} />}
            {nodeStatus === "success" && <CheckCircle2 size={14} className={styles.successIcon} />}
            {nodeStatus === "error" && <AlertCircle size={14} className={styles.errorIcon} />}
          </div>
        </div>
      </div>

      {/* Node Content */}
      {!isMinimized && (
        <div className={styles.content}>
          {/* Query Prompt Input */}
          <div>
            <label className={styles.label}>
              Prompt Instructions
            </label>
            <textarea
              ref={textareaRef}
              value={data.prompt}
              onChange={handlePromptChange}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              placeholder="e.g. Add error logs to standard handlers, optimize map lookups..."
              className={`nodrag ${styles.prompt}`}
            />
          </div>
        </div>
      )}

      {/* Node Footer */}
      <div className={styles.footer}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setSelectedNodeId(id);
            // Programmatically select this node in the Zustand store context
            const store = useWorkspaceStore.getState();
            const canvasCtx = store.canvasContexts[tabId];
            if (canvasCtx) {
              const updatedNodes = canvasCtx.nodes.map((n) => ({
                ...n,
                selected: n.id === id,
              }));
              store.updateCanvasContext(tabId, { nodes: updatedNodes });
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className={`nodrag ${styles.openPane}`}
          title="Open Details Pane"
        >
          <Settings size={13} />
          <span>Open Pane</span>
        </button>
        <span className={styles.model}>
          {data.model || "default"}
        </span>
      </div>

      {/* Handles */}
      {/* Task connections (horizontal: Left & Right) */}
      <Handle
        type="target"
        position={Position.Left}
        id="task-in"
        style={{ background: "var(--color-primary)", width: 14, height: 14, border: "2.5px solid var(--color-surface-sidebar)" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="task-out"
        style={{ background: "var(--color-primary)", width: 14, height: 14, border: "2.5px solid var(--color-surface-sidebar)" }}
      />

      {/* Context connections (vertical: Top & Bottom) */}
      <Handle
        type="target"
        position={Position.Top}
        id="context-in-top"
        style={{ background: "var(--color-status-success-solid)", width: 14, height: 14, border: "2.5px solid var(--color-surface-sidebar)" }}
      />
      <Handle
        type="target"
        position={Position.Bottom}
        id="context-in-bottom"
        style={{ background: "var(--color-status-success-solid)", width: 14, height: 14, border: "2.5px solid var(--color-surface-sidebar)" }}
      />
    </div>
  );
});
