import React from "react";
import { Search, X, File, AlignLeft, Info } from "lucide-react";
import { SearchMatch } from "../services/searchService";
import styles from "./SearchPalette.module.css";

interface SearchPaletteViewProps {
  query: string;
  setQuery: (q: string) => void;
  matchCase: boolean;
  setMatchCase: (v: boolean) => void;
  wholeWord: boolean;
  setWholeWord: (v: boolean) => void;
  isRegex: boolean;
  setIsRegex: (v: boolean) => void;
  searching: boolean;
  results: SearchMatch[];
  selectedIndex: number;
  groupedResults: Record<string, { name: string; items: SearchMatch[] }>;
  rootPath: string | null;
  onClose: () => void;
  handleSelectResult: (match: SearchMatch) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export const SearchPaletteView: React.FC<SearchPaletteViewProps> = ({
  query,
  setQuery,
  matchCase,
  setMatchCase,
  wholeWord,
  setWholeWord,
  isRegex,
  setIsRegex,
  searching,
  results,
  selectedIndex,
  groupedResults,
  rootPath,
  onClose,
  handleSelectResult,
  inputRef,
  containerRef,
}) => {
  let currentFlatIndex = 0;

  return (
    <div className={styles.overlay}>
      <div
        ref={containerRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Search workspace"
      >
        {/* Top Search Area */}
        <div className={styles.searchBar}>
          <Search size={16} className={styles.mutedIcon} />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search filenames and references..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={styles.input}
          />

          {/* Search Filters */}
          <div className={styles.filters}>
            <button
              onClick={() => setMatchCase(!matchCase)}
              className={`${styles.filter} ${matchCase ? styles.filterActive : ""}`}
              title="Match Case (Aa)"
            >
              Aa
            </button>
            <button
              onClick={() => setWholeWord(!wholeWord)}
              className={`${styles.filter} ${wholeWord ? styles.filterActive : ""}`}
              title="Whole Word (W)"
            >
              W
            </button>
            <button
              onClick={() => setIsRegex(!isRegex)}
              className={`${styles.filter} ${isRegex ? styles.filterActive : ""}`}
              title="Use Regex (.*)"
            >
              .*
            </button>
          </div>

          <button
            onClick={onClose}
            className={styles.close}
            aria-label="Close search"
          >
            <X size={16} />
          </button>
        </div>

        {/* Results Area */}
        <div className={styles.results}>
          {/* WebKit (Tauri's macOS WKWebView) miscomputes scrollHeight when a
              single element is both a flex/overflow-y:auto item and a grid
              container — it reports scrollHeight === clientHeight and silently
              clips content instead of scrolling. Keeping the scroll container
              (.results) and the grid container (.groups) as separate elements
              avoids that quirk while behaving identically in Chromium. */}
          <div className={styles.groups}>
            {searching && (
              <div className={styles.state}>
                <span className={styles.spinner} />
                <span>Searching workspace...</span>
              </div>
            )}

            {!searching && results.length === 0 && (
              <div className={`${styles.state} ${styles.emptyState}`}>
                <AlignLeft size={24} className={styles.mutedIcon} />
                <span>
                  {query.trim() ? "No search results match." : "Type a query above to search files and reference contents."}
                </span>
              </div>
            )}

            {!searching &&
              Object.entries(groupedResults).map(([filePath, fileGroup]) => {
                const relPath = rootPath ? filePath.replace(rootPath, "") : filePath;
                return (
                  <div key={filePath} className={styles.group}>
                    {/* File Header */}
                    <div className={styles.fileHeader}>
                      <File size={12} className={styles.mutedIcon} />
                      <span className={styles.fileName}>{fileGroup.name}</span>
                      <span className={styles.path}>{relPath}</span>
                    </div>

                    {/* Matches inside File */}
                    <div className={styles.matches}>
                      {fileGroup.items.map((item) => {
                        const flatIdx = currentFlatIndex;
                        currentFlatIndex++; // increment flat tracker
                        const isSelected = selectedIndex === flatIdx;

                        return (
                          <button
                            type="button"
                            key={item.line + "_" + item.content}
                            onClick={() => handleSelectResult(item)}
                            className={`${styles.match} ${isSelected ? styles.matchSelected : ""}`}
                          >
                            <div className={styles.matchInner}>
                              {item.is_content_match ? (
                                <>
                                  <span className={styles.line}>
                                    Line {item.line}
                                  </span>
                                  <span className={styles.content}>
                                    {item.content}
                                  </span>
                                </>
                              ) : (
                                <>
                                  <span className={styles.filenameBadge}>
                                    Filename
                                  </span>
                                  <span className={styles.filenameMatch}>
                                    {fileGroup.name} (match)
                                  </span>
                                </>
                              )}
                            </div>

                            {isSelected && (
                              <span className={styles.openHint}>
                                ↵ Open
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        {/* Footer Area */}
        <div className={styles.footer}>
          <div className={styles.footerGroup}>
            <Info size={10} className={styles.mutedIcon} />
            <span>Search scans all file contents in active workspace.</span>
          </div>
          <div className={styles.footerGroup}>
            <span>
              <kbd className={styles.key}>↑↓</kbd> navigate
            </span>
            <span>
              <kbd className={styles.key}>↵</kbd> select
            </span>
            <span>
              <kbd className={styles.key}>esc</kbd> close
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
