import React, { RefObject } from "react";
import { X, ChevronDown, Columns2 } from "lucide-react";
import { tabLabel } from "../tabs/split";
import { TabIcon, getTabView } from "../tabs/views";
import type { TabInstance } from "../tabs/types";
import styles from "./TabStrip.module.css";

interface TabStripViewProps {
  railId?: string;
  moveTab?: (id: string, index: number) => void;
  moveToOtherRail?: (id: string) => void;
  openTabs: TabInstance[];
  activeTabId: string | null;
  visibleTabIds: string[];
  splitShown: boolean;
  canSplit: boolean;
  toggleSplit: () => void;
  dropdownOpen: boolean;
  setDropdownOpen: (open: boolean) => void;
  activateTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  tabsContainerRef: RefObject<HTMLDivElement | null>;
}

type RailTabProps = Pick<TabStripViewProps, "activateTab" | "closeTab" | "moveTab" | "moveToOtherRail"> & {
  tab: TabInstance; index: number; active: boolean; railId: string;
};

function RailTab({ tab, index, active, railId, activateTab, closeTab, moveTab, moveToOtherRail }: RailTabProps) {
  const surface = getTabView(tab.type).surface;
  const activeStyle = surface === "canvas" ? styles.activeCanvas : styles.activeEditor;
  return <div id={`tab-${railId}-${tab.id}`} data-tab-id={tab.id} role="tab" aria-selected={active} tabIndex={0}
    className={`${styles.tab} ${active ? activeStyle : ""}`} draggable={Boolean(moveTab)}
    onClick={() => activateTab(tab.id)}
    onKeyDown={(event) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activateTab(tab.id); }
    }}
    onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-rusty-tab", tab.id); }}
    onDrop={(event) => { event.preventDefault(); event.stopPropagation(); moveTab?.(event.dataTransfer.getData("application/x-rusty-tab"), index); }}>
    {active && <div className={styles.accent} />}
    <TabIcon tab={tab} size={11} className={active ? styles.iconActive : styles.icon} />
    <span className={styles.title}>{tabLabel(tab)}</span>
    <div className={styles.tabActions}>
      {moveToOtherRail && <button id={`move-tab-${railId}-${tab.id}`} className={styles.iconButton}
        title="Move tab to other pane" aria-label={`Move ${tab.title} to other pane`}
        onClick={(event) => { event.stopPropagation(); moveToOtherRail(tab.id); }}><Columns2 size={10} /></button>}
      <button id={`close-tab-${railId}-${tab.id}`} className={styles.iconButton} title="Close tab" aria-label={`Close ${tab.title}`}
        onClick={(event) => { event.stopPropagation(); closeTab(tab.id); }}><X size={10} /></button>
    </div>
  </div>;
}

export const TabStripView: React.FC<TabStripViewProps> = ({
  railId = "left",
  moveTab,
  moveToOtherRail,
  openTabs,
  activeTabId,
  splitShown,
  canSplit,
  toggleSplit,
  dropdownOpen,
  setDropdownOpen,
  activateTab,
  closeTab,
  tabsContainerRef,
}) => {
  const [dragOver, setDragOver] = React.useState(false);
  return (
    <div className={styles.bar} data-tab-rail={railId}
      style={dragOver ? { boxShadow: "inset 0 -2px var(--color-primary)" } : undefined}
      onDragOver={(event) => { if (moveTab) { event.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDragEnd={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        moveTab?.(event.dataTransfer.getData("application/x-rusty-tab"), openTabs.length);
      }}
    >
      {/* Scrollable Tab Container */}
      {/* scrollbar-none/tabs-container used to be global classnames here --
          scrollbar-none was never actually defined anywhere (a dead,
          no-op utility) and tabs-container's only live effect (GPU
          compositing) now comes from styles.tabs composing gpuLayer
          (TabStrip.module.css). Both were also the one template-literal
          className in this migrated file, the one shape check-theme-usage
          .mjs's string-literal rule doesn't catch -- REFACTOR_PLAN.md PR 2
          commit 15 closes that out along with the rest of the GPU rule. */}
      <div ref={tabsContainerRef} className={styles.tabs} role="tablist" aria-label={`${railId} pane tabs`}>
        {openTabs.map((tab, index) => <RailTab key={tab.id} tab={tab} index={index}
          active={tab.id === activeTabId} railId={railId} activateTab={activateTab} closeTab={closeTab}
          moveTab={moveTab} moveToOtherRail={moveToOtherRail} />)}
      </div>

      {/* Tab Switcher Dropdown */}
      <div className={styles.switcher}>
        {(canSplit || splitShown) && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleSplit();
            }}
            className={`${styles.iconButton} ${splitShown ? styles.iconButtonOn : ""}`}
            title={splitShown ? "Close side-by-side view" : "Open side by side"}
            aria-pressed={splitShown}
          >
            <Columns2 size={14} />
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setDropdownOpen(!dropdownOpen);
          }}
          className={styles.iconButton}
          title="Open Editors"
        >
          <ChevronDown size={14} />
        </button>

        {dropdownOpen && (
          <>
            {/* Click-away backdrop overlay */}
            <div className={styles.backdrop} onClick={() => setDropdownOpen(false)} />
            <div className={styles.menu}>
              <div className={styles.menuTitle}>Open Editors</div>
              {openTabs.map((tab) => {
                const isActive = tab.id === activeTabId;
                return (
                  <div
                    key={tab.id}
                    onClick={() => {
                      activateTab(tab.id);
                      setDropdownOpen(false);
                    }}
                    className={`${styles.menuRow} ${isActive ? styles.menuRowActive : ""}`}
                  >
                    <div className={styles.menuIdentity}>
                      <TabIcon tab={tab} size={11} />
                      <span className={styles.title}>{tabLabel(tab)}</span>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(tab.id);
                        if (openTabs.length <= 1) {
                          setDropdownOpen(false);
                        }
                      }}
                      className={`${styles.iconButton} ${styles.menuClose}`}
                    >
                      <X size={10} />
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
