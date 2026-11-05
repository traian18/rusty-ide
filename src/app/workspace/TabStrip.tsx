import React, { useState, useEffect, useRef } from "react";
import { useWorkspaceStore } from "../../store";
import { TabStripView } from "./TabStrip.view";
import { requestCloseTab } from "../tabs/closeRequests";
import { canDuplicateTab, visibleTabIds } from "../tabs/split";

export const TabStrip: React.FC = () => {
  const openTabs = useWorkspaceStore((state) => state.tabs);
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const activateTab = useWorkspaceStore((state) => state.activateTab);
  const tabSplit = useWorkspaceStore((state) => state.tabSplit);
  const toggleSplit = useWorkspaceStore((state) => state.toggleSplit);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const tabsContainerRef = useRef<HTMLDivElement>(null);

  // Scroll active tab into view when activeTabId changes
  useEffect(() => {
    if (activeTabId && tabsContainerRef.current) {
      const activeEl = tabsContainerRef.current.querySelector(
        `[data-tab-id="${activeTabId}"]`
      );
      if (activeEl) {
        activeEl.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "nearest",
        });
      }
    }
  }, [activeTabId]);

  const visibleIds = visibleTabIds(activeTabId, tabSplit);
  const activeTab = openTabs.find((tab) => tab.id === activeTabId);
  const splitShown = visibleIds.length === 2;
  const canSplit = !tabSplit && activeTab !== undefined && canDuplicateTab(activeTab);

  return (
    <TabStripView
      openTabs={openTabs}
      activeTabId={activeTabId}
      visibleTabIds={visibleIds}
      splitShown={splitShown}
      canSplit={canSplit}
      toggleSplit={toggleSplit}
      dropdownOpen={dropdownOpen}
      setDropdownOpen={setDropdownOpen}
      activateTab={activateTab}
      // Close requests go through the shared channel so the unsaved/running
      // guards apply no matter which affordance was used.
      closeTab={requestCloseTab}
      tabsContainerRef={tabsContainerRef}
    />
  );
};
