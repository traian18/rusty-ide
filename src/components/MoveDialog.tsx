import React, { useState, useEffect, useRef, useMemo } from "react";
import { Folder, FolderOpen, ChevronDown, ChevronRight, Move, Check } from "lucide-react";
import { Modal } from "./ui/Modal/Modal";
import { Button } from "./ui/Button/Button";
import { Field } from "./ui/FormControls/Field";
import { Input } from "./ui/FormControls/Input";
import styles from "./MoveDialog.module.css";

interface MoveDialogProps {
  node: { name: string; path: string; is_dir: boolean };
  fileTree: any[];
  onMove: (destPath: string) => void;
  onCancel: () => void;
}

function getParentsForPath(path: string): string[] {
  const parts = path.split("/");
  const parents: string[] = [];
  let current = "";
  for (let i = 0; i < parts.length; i++) {
    current = current ? `${current}/${parts[i]}` : parts[i];
    parents.push(current);
  }
  return parents;
}

const truncatePathStart = (path: string, maxLen = 60) => {
  if (path.length <= maxLen) return path;
  return "…" + path.substring(path.length - maxLen + 1);
};

export const MoveDialog: React.FC<MoveDialogProps> = ({ node, fileTree, onMove, onCancel }) => {
  const parentDir = node.path.substring(0, node.path.lastIndexOf("/"));
  const [destPath, setDestPath] = useState(parentDir);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const treeScrollRef = useRef<HTMLDivElement>(null);

  const allDirs = useMemo(() => {
    const result: { path: string; name: string }[] = [];
    function traverse(entries: any[]) {
      for (const e of entries) {
        if (e.is_dir) {
          result.push({ path: e.path, name: e.name });
          if (e.children) traverse(e.children);
        }
      }
    }
    traverse(fileTree);
    return result;
  }, [fileTree]);

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
    return new Set(getParentsForPath(parentDir));
  });

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      const len = inputRef.current.value.length;
      inputRef.current.setSelectionRange(len, len);
    }
  }, []);

  useEffect(() => {
    if (treeScrollRef.current) {
      const selected = treeScrollRef.current.querySelector("[data-selected='true']");
      if (selected) {
        selected.scrollIntoView({ block: "center" });
      }
    }
  }, [expandedFolders]);

  const suggestions = useMemo(() => {
    if (!destPath) return [];
    const trimmed = destPath.trim().toLowerCase();
    return allDirs
      .filter(d => {
        if (d.path === node.path || d.path.startsWith(node.path + "/")) return false;
        if (trimmed.endsWith("/")) {
          return d.path.toLowerCase().startsWith(trimmed);
        }
        const lastSlash = d.path.lastIndexOf("/");
        const dirName = lastSlash >= 0 ? d.path.substring(lastSlash + 1) : d.path;
        return d.path.toLowerCase().startsWith(trimmed) || dirName.toLowerCase().includes(trimmed.split("/").pop() || "");
      })
      .slice(0, 10);
  }, [destPath, allDirs, node.path]);

  const handleMove = () => {
    const trimmed = destPath.trim();
    if (!trimmed) return;
    const fileName = node.path.split("/").pop() || "";
    const fullDest = trimmed.endsWith(fileName) ? trimmed : `${trimmed}/${fileName}`;
    onMove(fullDest);
  };

  const toggleFolder = (path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const renderFolderTree = (entries: any[], depth: number = 0): React.ReactNode => {
    return entries
      .filter((e: any) => e.is_dir)
      .map((entry: any) => {
        const isExpanded = expandedFolders.has(entry.path);
        const isSelected = destPath === entry.path;
        const childDirs = (entry.children || []).filter((c: any) => c.is_dir);
        return (
          <div key={entry.path}>
            <div
              data-selected={isSelected}
              onClick={() => setDestPath(entry.path)}
              className={`${styles.folderRow} ${isSelected ? styles.folderRowSelected : ""}`}
              style={{ paddingLeft: `${depth * 12 + 8}px` }}
            >
              <span
                onClick={(e) => { e.stopPropagation(); toggleFolder(entry.path); }}
                className={styles.folderToggle}
              >
                {childDirs.length > 0 ? (isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}
              </span>
              <span className={styles.folderIcon}>
                {isExpanded ? <FolderOpen size={12} /> : <Folder size={12} />}
              </span>
              <span className={styles.folderName}>{entry.name}</span>
            </div>
            {isExpanded && childDirs.length > 0 && (
              <div>{renderFolderTree(entry.children, depth + 1)}</div>
            )}
          </div>
        );
      });
  };

  const willMoveTo = destPath.trim().endsWith(node.name) ? destPath.trim() : `${destPath.trim()}/${node.name}`;

  return (
    <Modal
      id="move-dialog"
      title={`Move ${node.is_dir ? "Folder" : "File"}`}
      icon={Move}
      onClose={onCancel}
      size="lg"
      scrollableBody
      footer={
        <>
          <Button id="move-dialog-cancel" type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            id="move-dialog-confirm"
            type="button"
            variant="primary"
            icon={<Check size={13} />}
            onClick={handleMove}
            disabled={!destPath.trim()}
          >
            Move
          </Button>
        </>
      }
    >
      <p className={styles.pathInfo} title={node.path}>
        Current: <span className={styles.pathValue}>{truncatePathStart(node.path)}</span>
      </p>

      <Field id="move-dialog-destination" label="Destination folder">
        <div className={styles.destinationWrapper}>
          <Input
            ref={inputRef}
            id="move-dialog-destination"
            type="text"
            value={destPath}
            onChange={(e) => { setDestPath(e.target.value); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleMove();
            }}
            placeholder="Type a path or select from tree below..."
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className={styles.suggestions}>
              {suggestions.map((s) => (
                <div
                  key={s.path}
                  onMouseDown={(e) => { e.preventDefault(); setDestPath(s.path); setShowSuggestions(false); }}
                  className={styles.suggestionItem}
                  title={s.path}
                >
                  {truncatePathStart(s.path)}
                </div>
              ))}
            </div>
          )}
        </div>
      </Field>

      <div className={styles.treeContainer} ref={treeScrollRef}>
        <div className={styles.treeHeading}>Browse folders</div>
        {renderFolderTree(fileTree)}
      </div>

      {destPath && (
        <div className={styles.preview}>
          Will move to: <span className={styles.previewValue} title={willMoveTo}>{truncatePathStart(willMoveTo)}</span>
        </div>
      )}
    </Modal>
  );
};
