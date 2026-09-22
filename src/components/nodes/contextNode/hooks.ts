/**
 * Custom hooks for the ContextNode.
 *
 * Encapsulates reusable stateful logic:
 * - `useContextNodeSearch` — manages the file search overlay (debounce, results, keyboard index).
 * - `useContextNodeDrag`   — manages drag-over visual feedback.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { searchService, type SearchMatch } from "../../../services/searchService";

/* ------------------------------------------------------------------ */
/*  useDebouncedSearch                                                 */
/* ------------------------------------------------------------------ */

/** Options for the useDebouncedSearch hook. */
interface UseDebouncedSearchOptions {
  /** The root directory to search within. */
  rootPath?: string;
  /** Whether the search overlay is currently visible. */
  enabled: boolean;
}

/** Return value of useDebouncedSearch. */
interface UseDebouncedSearchReturn {
  /** Current search query string. */
  query: string;
  /** Sets the search query. */
  setQuery: (value: string) => void;
  /** Results returned from the file search. */
  results: SearchMatch[];
  /** Whether a search request is in-flight. */
  isSearching: boolean;
  /** Index of the currently highlighted result item. */
  selectedIndex: number;
  /** Sets the selected result index (for keyboard navigation). */
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  /** Ref to attach to the search input element for auto-focus. */
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

/**
 * Performs a debounced file-system search when the query changes.
 * Automatically focuses the search input when enabled.
 */
export function useDebouncedSearch(
  options: UseDebouncedSearchOptions,
): UseDebouncedSearchReturn {
  const { rootPath, enabled } = options;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const searchInputRef = useRef<HTMLInputElement>(null);

  /* ---- Debounced search ---- */
  useEffect(() => {
    if (!enabled) {
      setResults([]);
      setSelectedIndex(0);
      return;
    }

    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSelectedIndex(0);
      return;
    }

    setIsSearching(true);

    const timer = setTimeout(async () => {
      try {
        let matches: SearchMatch[] = [];

        if (rootPath) {
          try {
            matches = await searchService.searchProject({
              rootDir: rootPath,
              query: trimmed,
              matchCase: false,
              wholeWord: false,
              isRegex: false,
            });
          } catch {
            // Ignore workspace search errors for external path patterns
          }
        }

        // Also check if query is an existing external file or directory on the system
        try {
          const externalInfo = await searchService.checkExternalPath(trimmed);
          if (externalInfo && externalInfo.exists) {
            const externalMatch: SearchMatch = {
              path: externalInfo.path,
              name: externalInfo.name,
              line: 0,
              content: externalInfo.is_dir ? "External Directory" : "External File",
              is_content_match: false,
            };
            if (!matches.some((m) => m.path === externalMatch.path)) {
              matches = [externalMatch, ...matches];
            }
          }
        } catch {
          // Ignore external path check errors
        }

        setResults(matches);
        setSelectedIndex(0);
      } catch (err) {
        console.error("[ContextNode] search failed:", err);
      } finally {
        setIsSearching(false);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [query, enabled, rootPath]);

  /* ---- Auto-focus search input when overlay opens ---- */
  useEffect(() => {
    if (enabled && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [enabled]);

  return {
    query,
    setQuery,
    results,
    isSearching,
    selectedIndex,
    setSelectedIndex,
    searchInputRef,
  };
}

/* ------------------------------------------------------------------ */
/*  useContextNodeDrag                                                 */
/* ------------------------------------------------------------------ */

/** Return value of useContextNodeDrag. */
interface UseContextNodeDragReturn {
  /** Whether a draggable item is currently hovering over the node. */
  dragOver: boolean;
  /** Handler for onDragOver events. */
  handleDragOver: (e: React.DragEvent) => void;
  /** Handler for onDragLeave events. */
  handleDragLeave: () => void;
  /** Handler for onDrop events. Sets dragOver to false after processing. */
  handleDrop: (e: React.DragEvent) => void;
}

/**
 * Manages the drag-over state for visual feedback when files are
 * dragged onto the ContextNode from the sidebar.
 *
 * Returns the current `dragOver` flag and bound event handlers.
 */
export function useContextNodeDrag(
  onDropCallback: (e: React.DragEvent) => void,
): UseContextNodeDragReturn {
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent): void => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((): void => {
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      onDropCallback(e);
    },
    [onDropCallback],
  );

  return {
    dragOver,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}
