import React from "react";
import { Search } from "lucide-react";
import { RustyIcon } from "./RustyIcon";
import styles from "./Header.module.css";

interface HeaderViewProps {
  onSearchOpen: () => void;
  searchShortcut: string;
  repositoryControl: React.ReactNode;
  toolExecutionControl: React.ReactNode;
  quotaControl: React.ReactNode;
}

export const HeaderView: React.FC<HeaderViewProps> = ({ onSearchOpen, searchShortcut, repositoryControl, toolExecutionControl, quotaControl }) => {
  const isMacOS = typeof navigator !== "undefined" && /Mac/.test(navigator.platform || navigator.userAgent);

  return (
    <header
      className={`${styles.header} ${isMacOS ? styles.macosHeader : ""}`}
      // The areas below fill the bar, so a bare region would never be hit
      // directly. "deep" drags from anywhere except buttons and inputs.
      data-tauri-drag-region="deep"
    >
      {/* Left Area: Logo, then the project and branch git is acting on */}
      <div className={styles.brandArea}>
        <div className={styles.brand}>
          <RustyIcon size={20} />
          <span className={styles.brandName}>
            Rusty
          </span>
        </div>
        {repositoryControl}
      </div>

      {/* Middle Area: Interactive Search Bar */}
      <div className={styles.searchArea}>
        <div className={styles.searchControl}>
          <Search size={12} className={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search workspace..."
            readOnly
            onClick={onSearchOpen}
            className={styles.searchInput}
          />
          <kbd className={styles.shortcut}>{searchShortcut}</kbd>
        </div>
      </div>

      {/* Right Area: execution observability, then provider quota. */}
      <div className={styles.headerActions}>
        {toolExecutionControl}
        <div className={styles.quota}>{quotaControl}</div>
      </div>
    </header>
  );
};
