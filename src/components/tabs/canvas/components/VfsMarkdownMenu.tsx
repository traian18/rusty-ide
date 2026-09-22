/**
 * VfsMarkdownMenu.tsx
 *
 * Canvas toolbar dropdown toggle for inspecting and opening all Markdown (.md)
 * files created in the active canvas's Virtual File System (VFS).
 *
 * Features:
 * - Lists all .md and .markdown files currently in the canvas VFS
 * - Real-time sync with VFS write/delete events
 * - One-click opening in FileTab with full VFS isolation and markdown rendering
 * - Quick copy button next to each file to copy the filename for prompt use
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  FileText,
  ChevronDown,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  FileCode,
} from "lucide-react";
import { VfsRegistry, VFS_CHANGED_EVENT, type VfsChangedDetail } from "../../../../services/vfs";
import { useWorkspaceStore } from "../../../../store";
import { FileIcon } from "../../../../services/fileTypeService";

interface VfsMarkdownMenuProps {
  tabId: string;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}

const getFileName = (path: string): string => {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
};

const getFileDir = (path: string): string => {
  const parts = path.replace(/\\/g, "/").split("/");
  parts.pop();
  return parts.join("/") || "/";
};

export const VfsMarkdownMenu: React.FC<VfsMarkdownMenuProps> = ({
  tabId,
  isOpen,
  onToggle,
  onClose,
}) => {
  const openTab = useWorkspaceStore((state) => state.openTab);
  const [mdFiles, setMdFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedFile, setCopiedFile] = useState<string | null>(null);

  const loadMdFiles = useCallback(async () => {
    if (!tabId) return;
    setLoading(true);
    try {
      const vfs = VfsRegistry.getOrCreate(tabId);
      const [snap, nodeEntries] = await Promise.all([
        vfs.snapshot().catch(() => ({ contents: {}, tracker: {} })),
        vfs.getAllNodeFiles().catch(() => []),
      ]);

      const found = new Set<string>();

      // 1. Files in in-memory VFS snapshot contents
      for (const p of Object.keys(snap.contents || {})) {
        if (/\.(md|markdown)$/i.test(p)) {
          found.add(p);
        }
      }

      // 2. Files tracked under nodes
      for (const entry of nodeEntries) {
        for (const p of entry.files) {
          if (/\.(md|markdown)$/i.test(p)) {
            found.add(p);
          }
        }
      }

      // 3. Files in canvas context modifiedFiles
      const canvasCtx = useWorkspaceStore.getState().canvasContexts[tabId];
      if (canvasCtx) {
        for (const node of canvasCtx.nodes) {
          const mFiles: string[] = (node.data?.modifiedFiles as string[]) || [];
          for (const p of mFiles) {
            if (/\.(md|markdown)$/i.test(p)) {
              found.add(p);
            }
          }
        }
      }

      setMdFiles(Array.from(found).sort((a, b) => getFileName(a).localeCompare(getFileName(b))));
    } catch (err) {
      console.error("[VfsMarkdownMenu] Failed to load MD files:", err);
    } finally {
      setLoading(false);
    }
  }, [tabId]);

  useEffect(() => {
    void loadMdFiles();
  }, [loadMdFiles]);

  // Refresh when dropdown opens to guarantee latest state
  useEffect(() => {
    if (isOpen) {
      void loadMdFiles();
    }
  }, [isOpen, loadMdFiles]);

  // Live reload on VFS changes
  useEffect(() => {
    const handleVfsChanged = (event: Event) => {
      const detail = (event as CustomEvent<VfsChangedDetail>).detail;
      if (detail && detail.tabId === tabId) {
        void loadMdFiles();
      }
    };

    window.addEventListener(VFS_CHANGED_EVENT, handleVfsChanged);
    return () => window.removeEventListener(VFS_CHANGED_EVENT, handleVfsChanged);
  }, [tabId, loadMdFiles]);

  const handleOpenFile = (filePath: string) => {
    openTab({
      type: "file",
      path: filePath,
      title: `${getFileName(filePath)} (VFS)`,
      vfsTabId: tabId,
    });
    onClose();
  };

  const handleCopyName = (fileName: string, filePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(fileName);
    setCopiedFile(filePath);
    setTimeout(() => setCopiedFile(null), 1500);
  };

  return (
    <div className="relative">
      {/* Toggle Button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        title="View all Markdown (.md) files created in the VFS"
        className={`bg-[var(--bg-sidebar)] border ${
          isOpen || mdFiles.length > 0
            ? "border-[var(--border-active)] text-[var(--text-light)]"
            : "border-[var(--border-color)] text-[var(--text-muted)]"
        } hover:bg-[var(--bg-header)] hover:text-[var(--text-light)] text-xs font-mono font-semibold px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition-all shadow-md cursor-pointer nodrag`}
      >
        <FileText size={14} className="text-[var(--accent-color)]" />
        <span>MD Files</span>
        {mdFiles.length > 0 && (
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-[var(--accent-bg)] text-[var(--accent-color)] font-bold border border-[var(--accent-color)]/30 leading-none">
            {mdFiles.length}
          </span>
        )}
        <ChevronDown
          size={12}
          className={`transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 mt-2 w-80 bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl shadow-2xl overflow-hidden z-50 font-mono animate-in fade-in zoom-in-95 duration-100"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-header)]">
            <div className="flex items-center space-x-1.5">
              <FileCode size={13} className="text-[var(--accent-color)]" />
              <span className="text-xs font-semibold text-[var(--text-light)]">VFS Markdown Files</span>
              <span className="text-[10px] text-[var(--text-muted)]">
                ({mdFiles.length})
              </span>
            </div>
            <button
              type="button"
              onClick={() => void loadMdFiles()}
              className="p-1 text-[var(--text-muted)] hover:text-[var(--text-light)] transition-colors rounded hover:bg-[var(--bg-sidebar)]"
              title="Refresh VFS files"
            >
              <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
            </button>
          </div>

          {/* Files List */}
          <div className="max-h-72 overflow-y-auto">
            {mdFiles.length === 0 ? (
              <div className="p-5 text-center text-xs text-[var(--text-muted)] flex flex-col items-center gap-1.5">
                <FileText size={22} className="text-[var(--text-muted)]/40" />
                <span className="font-medium text-[var(--text-light)]">No MD files in VFS yet</span>
                <span className="text-[10px] text-[var(--text-muted)]/80">
                  Files with .md extension created by agents or tasks will appear here.
                </span>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-color)]/30">
                {mdFiles.map((filePath) => {
                  const fileName = getFileName(filePath);
                  const fileDir = getFileDir(filePath);
                  const isCopied = copiedFile === filePath;

                  return (
                    <div
                      key={filePath}
                      onClick={() => handleOpenFile(filePath)}
                      className="flex items-center justify-between px-3 py-2 hover:bg-[var(--accent-bg)]/20 cursor-pointer group transition-colors"
                      title="Click to open in FileTab"
                    >
                      <div className="flex items-center space-x-2 min-w-0 flex-1 mr-2">
                        <FileIcon fileName={filePath} size={14} className="flex-shrink-0" />
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-semibold text-[var(--text-light)] group-hover:text-[var(--accent-color)] truncate">
                            {fileName}
                          </span>
                          <span className="text-[9px] text-[var(--text-muted)] truncate" title={fileDir}>
                            {fileDir}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center space-x-1 flex-shrink-0">
                        {/* Copy filename button */}
                        <button
                          type="button"
                          onClick={(e) => handleCopyName(fileName, filePath, e)}
                          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-light)] hover:bg-[var(--bg-header)] transition-colors"
                          title="Copy file name for prompt"
                        >
                          {isCopied ? (
                            <Check size={12} className="text-[var(--color-status-success)]" />
                          ) : (
                            <Copy size={12} />
                          )}
                        </button>

                        {/* Open in FileTab button */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenFile(filePath);
                          }}
                          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-light)] hover:bg-[var(--bg-header)] transition-colors"
                          title="Open in FileTab"
                        >
                          <ExternalLink size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
