import React, { memo, useState, useRef, useEffect, useContext } from "react";
import { Trash2, GripHorizontal, Minus, Plus } from "lucide-react";
import { useViewport } from "@xyflow/react";
import { useWorkspaceStore } from "../../../store";
import { CanvasTabContext } from "../../tabs/canvas/CanvasTabContext";
import styles from "./BoundaryNode.module.css";

export const BoundaryNode: React.FC<{ id: string; data: any }> = memo(({ id, data }) => {
  const { tabId } = useContext(CanvasTabContext);
  const { zoom } = useViewport();
  const updateNode = useWorkspaceStore((state) => state.updateTaskNode);
  const updateNodePosition = useWorkspaceStore((state) => state.updateNodePosition);
  const deleteNode = useWorkspaceStore((state) => state.deleteNode);
  const nodePosition = useWorkspaceStore((state) => {
    const ctx = state.canvasContexts[tabId];
    if (!ctx) return { x: 0, y: 0 };
    const n = ctx.nodes.find((nd) => nd.id === id);
    return n ? n.position : { x: 0, y: 0 };
  });

  const [name, setName] = useState(data.name || "Boundary");
  const [isEditingName, setIsEditingName] = useState(false);

  const isResizingRef = useRef(false);
  const isDraggingRef = useRef(false);
  const startDimensions = useRef({
    width: 0,
    height: 0,
    pointerX: 0,
    pointerY: 0,
    nodeX: 0,
    nodeY: 0,
    corner: "se" as ResizeCorner,
  });
  const startDragPos = useRef({ x: 0, y: 0, nodeX: 0, nodeY: 0 });
  const dataRef = useRef(data);
  const posRef = useRef(nodePosition);
  const zoomRef = useRef(zoom);

  type ResizeCorner = "nw" | "ne" | "sw" | "se";

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    posRef.current = nodePosition;
  }, [nodePosition]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    setName(data.name || "Boundary");
  }, [data.name]);

  const handleNameSave = () => {
    setIsEditingName(false);
    if (name !== dataRef.current.name) {
      updateNode(id, { name });
    }
  };

  const handleNameDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditingName(true);
  };

  const handleResizeMouseDown = (corner: ResizeCorner) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isResizingRef.current = true;
    startDimensions.current = {
      width: dataRef.current.width || 300,
      height: dataRef.current.height || 200,
      pointerX: e.clientX,
      pointerY: e.clientY,
      nodeX: posRef.current.x,
      nodeY: posRef.current.y,
      corner,
    };
    document.addEventListener("mousemove", handleResizeMouseMove);
    document.addEventListener("mouseup", handleResizeMouseUp);
  };

  const handleResizeMouseMove = (e: MouseEvent) => {
    if (!isResizingRef.current) return;
    const start = startDimensions.current;
    const deltaX = (e.clientX - start.pointerX) / zoomRef.current;
    const deltaY = (e.clientY - start.pointerY) / zoomRef.current;
    const fromLeft = start.corner === "nw" || start.corner === "sw";
    const fromTop = start.corner === "nw" || start.corner === "ne";
    const newWidth = Math.max(150, start.width + (fromLeft ? -deltaX : deltaX));
    const newHeight = Math.max(100, start.height + (fromTop ? -deltaY : deltaY));
    const newX = fromLeft ? start.nodeX + start.width - newWidth : start.nodeX;
    const newY = fromTop ? start.nodeY + start.height - newHeight : start.nodeY;

    updateNodePosition(id, newX, newY);
    updateNode(id, { width: newWidth, height: newHeight });
  };

  const handleResizeMouseUp = () => {
    isResizingRef.current = false;
    document.removeEventListener("mousemove", handleResizeMouseMove);
    document.removeEventListener("mouseup", handleResizeMouseUp);
  };

  const handleDragMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDraggingRef.current = true;
    startDragPos.current = {
      x: e.clientX,
      y: e.clientY,
      nodeX: posRef.current.x,
      nodeY: posRef.current.y
    };
    document.addEventListener("mousemove", handleDragMouseMove);
    document.addEventListener("mouseup", handleDragMouseUp);
  };

  const handleDragMouseMove = (e: MouseEvent) => {
    if (!isDraggingRef.current) return;
    const deltaX = (e.clientX - startDragPos.current.x) / zoomRef.current;
    const deltaY = (e.clientY - startDragPos.current.y) / zoomRef.current;
    const newX = startDragPos.current.nodeX + deltaX;
    const newY = startDragPos.current.nodeY + deltaY;
    updateNodePosition(id, newX, newY);
  };

  const handleDragMouseUp = () => {
    isDraggingRef.current = false;
    document.removeEventListener("mousemove", handleDragMouseMove);
    document.removeEventListener("mouseup", handleDragMouseUp);
  };

  useEffect(() => {
    return () => {
      document.removeEventListener("mousemove", handleResizeMouseMove);
      document.removeEventListener("mouseup", handleResizeMouseUp);
      document.removeEventListener("mousemove", handleDragMouseMove);
      document.removeEventListener("mouseup", handleDragMouseUp);
    };
  }, []);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    deleteNode(id);
  };

  const width = data.width || 300;
  const height = data.height || 200;
  const fontSize = Math.min(32, Math.max(10, data.fontSize || 12));

  const changeFontSize = (delta: number) => {
    updateNode(id, { fontSize: Math.min(32, Math.max(10, fontSize + delta)) });
  };

  return (
    <div
      className={`nodrag nopan ${styles.root}`}
      style={{
        width,
        height,
        pointerEvents: "none",
      }}
    >
      {/* Name label above the boundary (outside the box) */}
      <div
        className={styles.labelRow}
      >
        {isEditingName ? (
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={handleNameSave}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleNameSave();
              if (e.key === "Escape") {
                setName(dataRef.current.name || "Boundary");
                setIsEditingName(false);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className={`nodrag nopan ${styles.nameInput}`}
            style={{ fontSize }}
            autoFocus
          />
        ) : (
          <span
            onDoubleClick={handleNameDoubleClick}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className={`nodrag nopan ${styles.name}`}
            style={{ fontSize, lineHeight: 1.25 }}
            title="Double-click to rename"
          >
            {name}
          </span>
        )}
        <div className={styles.sizeActions}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); changeFontSize(-2); }}
            onPointerDown={(e) => e.stopPropagation()}
            className={`nodrag nopan ${styles.iconButton}`}
            title="Decrease title size"
          >
            <Minus size={12} />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); changeFontSize(2); }}
            onPointerDown={(e) => e.stopPropagation()}
            className={`nodrag nopan ${styles.iconButton}`}
            title="Increase title size"
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      {/* Boundary rectangle - click-through, visual only */}
      <div
        className={styles.boundary}
      />

      {/* Drag bar at top edge - the only part that moves the boundary */}
      <div
        className={`nodrag nopan ${styles.dragBar}`}
        onMouseDown={handleDragMouseDown}
        onPointerDown={(e) => e.stopPropagation()}
        title="Drag to move boundary"
      >
        <GripHorizontal
          size={14}
          className={styles.dragIcon}
        />
      </div>

      {/* Corner resize handles */}
      <div
        className={`nodrag nopan resize-handle ${styles.resize} ${styles.nw}`}
        onMouseDown={handleResizeMouseDown("nw")}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className={styles.resizeKnob} />
      </div>
      <div
        className={`nodrag nopan resize-handle ${styles.resize} ${styles.ne}`}
        onMouseDown={handleResizeMouseDown("ne")}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className={styles.resizeKnob} />
      </div>
      <div
        className={`nodrag nopan resize-handle ${styles.resize} ${styles.sw}`}
        onMouseDown={handleResizeMouseDown("sw")}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className={styles.resizeKnob} />
      </div>
      <div
        className={`nodrag nopan resize-handle ${styles.resize} ${styles.se}`}
        onMouseDown={handleResizeMouseDown("se")}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className={styles.resizeKnob} />
      </div>

      {/* Delete button */}
      <button
        onClick={handleDelete}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        className={`nodrag nopan ${styles.delete}`}
        title="Delete boundary"
      >
        <Trash2 size={10} />
      </button>
    </div>
  );
});
