import React, { useState, useEffect, useRef } from "react";
import { useWorkspaceStore } from "../../store";
import { TabStripView } from "./TabStrip.view";
import { requestCloseTab } from "../tabs/closeRequests";
import { visibleTabIds } from "../tabs/split";
import { railIds } from "../tabs/rails";
import type { TabGroupSide } from "../tabs/groups";

export const TabStrip: React.FC<{ side?: TabGroupSide }> = ({ side = "left" }) => {
  const openTabs = useWorkspaceStore((state) => state.tabs);
  const globalActiveId = useWorkspaceStore((state) => state.activeTabId);
  const activateTab = useWorkspaceStore((state) => state.activateTab);
  const tabSplit = useWorkspaceStore((state) => state.tabSplit);
  const toggleSplit = useWorkspaceStore((state) => state.toggleSplit);

  const moveTab = useWorkspaceStore((state) => state.moveTabToRail);
  const activeTabId = tabSplit ? tabSplit[side] : globalActiveId;
  const ids = tabSplit ? railIds(tabSplit, openTabs, side) : openTabs.map((tab) => tab.id);
  const railTabs = ids.flatMap((id) => openTabs.filter((tab) => tab.id === id));
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
  const hasSplitPartner = activeTab?.type === "file" || openTabs.length > 1;
  const canSplit = !tabSplit && activeTab !== undefined && hasSplitPartner;

  return (
    <TabStripView
      openTabs={railTabs}
      railId={side}
      moveTab={tabSplit ? (id, index) => moveTab(id, side, index) : undefined}
      moveToOtherRail={tabSplit ? (id) => moveTab(id, side === "left" ? "right" : "left") : undefined}
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
