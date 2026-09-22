import React, { memo, useState, useRef, useEffect, useContext } from "react";
import { Trash2 } from "lucide-react";
import { useWorkspaceStore } from "../../../store";
import { STICKY_COLORS, getNextColor } from "./stickyColors";
import { CanvasTabContext } from "../../tabs/canvas/CanvasTabContext";
import styles from "./StickyNode.module.css";

export const StickyNode: React.FC<{ id: string; data: any }> = memo(({ id, data }) => {
  const { tabId } = useContext(CanvasTabContext);
  const updateNode = useWorkspaceStore((state) => state.updateTaskNode);
  const deleteNode = useWorkspaceStore((state) => state.deleteNode);
  const updateCanvasContext = useWorkspaceStore((state) => state.updateCanvasContext);

  const initialColor = STICKY_COLORS.find((c) => c.name === data.color) || STICKY_COLORS[0];
  const [color, setColor] = useState(initialColor);
  const [content, setContent] = useState(data.content || "");
  const [isEditing, setIsEditing] = useState(false);

  const [width, setWidth] = useState(data.width || 200);
  const [height, setHeight] = useState(data.height || 150);
  const isResizing = useRef(false);
  const startDimensions = useRef({ width: 0, height: 0, x: 0, y: 0 });

  const handleColorSwitch = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextColor = getNextColor(color.name);
    setColor(nextColor);
    updateNode(id, { color: nextColor.name });
    updateCanvasContext(tabId, { lastStickyColor: nextColor.name });
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
  };

  const handleContentBlur = () => {
    setIsEditing(false);
    if (content !== data.content) {
      updateNode(id, { content });
    }
  };

  const handleContentFocus = () => {
    setIsEditing(true);
  };

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isResizing.current = true;
    startDimensions.current = {
      width,
      height,
      x: e.clientX,
      y: e.clientY
    };
    document.addEventListener("mousemove", handleResize);
    document.addEventListener("mouseup", stopResize);
  };

  const handleResize = (e: MouseEvent) => {
    if (!isResizing.current) return;
    const deltaX = e.clientX - startDimensions.current.x;
    const deltaY = e.clientY - startDimensions.current.y;
    const newWidth = Math.max(150, startDimensions.current.width + deltaX);
    const newHeight = Math.max(100, startDimensions.current.height + deltaY);
    setWidth(newWidth);
    setHeight(newHeight);
    updateNode(id, { width: newWidth, height: newHeight });
  };

  const stopResize = () => {
    isResizing.current = false;
    document.removeEventListener("mousemove", handleResize);
    document.removeEventListener("mouseup", stopResize);
  };

  useEffect(() => {
    return () => {
      document.removeEventListener("mousemove", handleResize);
      document.removeEventListener("mouseup", stopResize);
    };
  }, []);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    deleteNode(id);
  };

  return (
    <div
      className={`${styles.note} ${styles[color.name]}`}
      style={{
        width: `${width}px`,
        height: `${height}px`,
      }}
    >
      {/* Header - Color indicator and controls */}
      <div
        className={styles.header}
      >
        <div className={styles.dots}>
          <div className={styles.dotLarge} />
          <div className={styles.dotSmall} />
        </div>
        <div className={styles.actions}>
          <button
            onClick={handleColorSwitch}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className={`nodrag ${styles.colorButton}`}
            aria-label="Switch note color"
            title="Switch color"
          />
          <button
            onClick={handleDelete}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className={`nodrag ${styles.delete}`}
            title="Delete note"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Content area */}
      <div
        className={styles.content}
        onClick={handleContentFocus}
      >
        <textarea
          value={content}
          onChange={handleContentChange}
          onBlur={handleContentBlur}
          onFocus={handleContentFocus}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          placeholder="Type your note..."
          className={`nodrag ${styles.textarea} ${isEditing ? styles.editing : styles.readonly}`}
          style={{
            overflowY: isEditing ? "auto" : "hidden",
          }}
          readOnly={!isEditing}
          onClick={(e) => {
            if (!isEditing) {
              e.stopPropagation();
            }
          }}
        />
      </div>

      {/* Resize Handle */}
      <div
        onMouseDown={startResize}
        onPointerDown={(e) => e.stopPropagation()}
        className={`nodrag ${styles.resize}`}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          className={styles.resizeIcon}
        >
          <line x1="2" y1="10" x2="10" y2="2" stroke="currentColor" strokeWidth="1.5" />
          <line x1="5" y1="10" x2="10" y2="5" stroke="currentColor" strokeWidth="1.5" />
          <line x1="8" y1="10" x2="10" y2="8" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </div>
    </div>
  );
});
