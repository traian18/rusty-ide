/**
 * ContextNodeSearchOverlay — full-size search panel that overlays the node.
 *
 * Allows the user to search for files in the workspace and attach one
 * to this context node. Supports keyboard navigation (↑/↓, Enter, Escape)
 * and displays up to 20 results.
 */

import React from "react";
import { Search, X, Upload } from "lucide-react";
import { FileIcon } from "../../../services/fileTypeService";
import { formatRelativePath } from "./helpers";
import { stopNodePropagation } from "../globalChat/stopPropagation";
import type { SearchMatch } from "../../../services/searchService";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ContextNodeSearchOverlayProps {
  /** Current search query. */
  query: string;
  /** Search results to display. */
  results: SearchMatch[];
  /** Whether a search is in progress. */
  isSearching: boolean;
  /** Index of the currently highlighted result. */
  selectedIndex: number;
  /** Root path used to compute relative paths for display. */
  rootPath: string | undefined;
  /** Ref to attach to the search input element. */
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Fired when the query text changes. */
  onQueryChange: (value: string) => void;
  /** Fired when a result is selected (click or Enter). */
  onResultSelect: (match: SearchMatch) => void;
  /** Fired on keyboard events within the search input. */
  onKeyDown: (e: React.KeyboardEvent) => void;
  /** Fired to open native file picker for any file. */
  onBrowseFile: () => void;
  /** Fired to close the overlay. */
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  MAX_VISIBLE_RESULTS                                                */
/* ------------------------------------------------------------------ */

/** Maximum number of search results to display at once. */
const MAX_VISIBLE_RESULTS = 20;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export const ContextNodeSearchOverlay: React.FC<ContextNodeSearchOverlayProps> = ({
  query,
  results,
  isSearching,
  selectedIndex,
  rootPath,
  inputRef,
  onQueryChange,
  onResultSelect,
  onKeyDown,
  onBrowseFile,
  onClose,
}) => {
  return (
    <div className="absolute inset-0 z-50 bg-[var(--bg-sidebar)]/98 backdrop-blur-sm flex flex-col rounded-xl overflow-hidden">
      {/* ---- Search Bar ---- */}
      <div className="flex items-center space-x-2 px-3 py-2 border-b border-[var(--border-color)] bg-[var(--color-surface-sunken)]">
        <Search size={13} className="text-[var(--color-status-success)] flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search files..."
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          className="flex-1 bg-[var(--bg-app)] border border-[var(--border-color)] rounded px-2 py-1 text-xs text-[var(--text-light)] focus:border-[var(--color-status-success-border)] focus:outline-none"
        />
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          onPointerDown={stopNodePropagation}
          onMouseDown={stopNodePropagation}
          className="nodrag text-[var(--text-muted)] hover:text-[var(--text-light)] p-0.5 cursor-pointer"
        >
          <X size={13} />
        </button>
      </div>

      {/* ---- Browse external file banner ---- */}
      <div className="px-2 py-1.5 border-b border-[var(--border-color)] bg-[var(--bg-app)]/40">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onBrowseFile();
          }}
          onPointerDown={stopNodePropagation}
          onMouseDown={stopNodePropagation}
          className="nodrag w-full flex items-center justify-center space-x-1.5 py-1.5 px-2 rounded-lg bg-[var(--color-surface-sunken)] border border-[var(--border-color)] hover:border-[var(--color-status-success)] text-[10px] text-[var(--text-normal)] hover:text-[var(--color-status-success)] transition-all cursor-pointer"
        >
          <Upload size={11} className="text-[var(--color-status-success)]" />
          <span>Browse any file or folder from computer...</span>
        </button>
      </div>

      {/* ---- Results List ---- */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {isSearching && (
          <div className="py-4 text-center text-[10px] text-[var(--text-muted)]">
            Searching...
          </div>
        )}

        {!isSearching && results.length === 0 && query && (
          <div className="py-4 px-2 text-center space-y-2">
            <div className="text-[10px] text-[var(--text-muted)]">
              No files found in workspace matching &ldquo;{query}&rdquo;
            </div>
            <button
              type="button"
              onClick={() => {
                const trimmed = query.trim();
                const name = trimmed.split(/[\\/]/).pop() || trimmed;
                onResultSelect({
                  path: trimmed,
                  name,
                  line: 0,
                  content: "External Path",
                  is_content_match: false,
                });
              }}
              onPointerDown={stopNodePropagation}
              onMouseDown={stopNodePropagation}
              className="nodrag w-full py-1.5 px-2.5 rounded-lg bg-[var(--color-surface-sunken)] border border-[var(--border-color)] hover:border-[var(--color-status-success)] text-[11px] text-[var(--text-normal)] hover:text-[var(--color-status-success)] flex items-center justify-center space-x-1.5 transition-colors cursor-pointer"
            >
              <Upload size={11} className="text-[var(--color-status-success)]" />
              <span>Attach external path: <strong className="font-mono text-[10px]">{query.trim()}</strong></span>
            </button>
          </div>
        )}

        {!isSearching && results.length === 0 && !query && (
          <div className="py-4 text-center text-[10px] text-[var(--text-muted)]">
            Type to search files or paste external path
          </div>
        )}

        {results.slice(0, MAX_VISIBLE_RESULTS).map((match, idx) => {
          const relPath = formatRelativePath(rootPath, match);
          const isSelected = selectedIndex === idx;
          const isExternal = match.content?.startsWith("External") || (rootPath && !match.path.startsWith(rootPath));

          return (
            <button
              key={`${match.path}-${idx}`}
              onClick={() => onResultSelect(match)}
              className={`w-full text-left px-2.5 py-2 rounded-lg text-[11px] flex items-center space-x-2 transition-colors cursor-pointer ${
                isSelected
                  ? "bg-[var(--color-status-success-bg)] text-[var(--color-status-success)] border border-[var(--color-status-success-border)]"
                  : "text-[var(--text-normal)] hover:bg-[var(--accent-bg)]"
              }`}
            >
              <FileIcon fileName={match.name} size={13} className="flex-shrink-0" />
              <div className="flex flex-col min-w-0 flex-1">
                <div className="flex items-center space-x-1.5 min-w-0">
                  <span className="font-medium truncate">{match.name}</span>
                  {isExternal && (
                    <span className="px-1 py-0.2 rounded bg-[var(--color-status-info-bg)] border border-[var(--color-status-info-border)] text-[8px] text-[var(--color-status-info)] flex-shrink-0 font-mono">
                      External
                    </span>
                  )}
                </div>
                <span className="text-[9px] text-[var(--text-muted)] truncate font-mono">
                  {relPath}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* ---- Footer Help ---- */}
      <div className="px-3 py-1.5 border-t border-[var(--border-color)] bg-[var(--color-surface-sunken)] text-[9px] text-[var(--text-muted)] flex items-center justify-between">
        <span>↑↓ navigate</span>
        <span>↵ select</span>
        <span>esc close</span>
      </div>
    </div>
  );
};
