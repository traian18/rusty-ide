import React, { useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "../../store";
import { shouldKeepMounted } from "../tabs/policy";
import { visibleTabIds } from "../tabs/split";
import { TabPanel, getTabView, type TabViewContext } from "../tabs/views";
import { ErrorBoundary } from "../ErrorBoundary";
import { TabCrashFallback } from "./TabCrashFallback";
import { useSplitWidth } from "./useSplitWidth";
import styles from "./TabOutlet.module.css";

interface TabOutletProps {
  context: TabViewContext;
}

/**
 * Renders the active tab's panel, plus any kept-mounted tabs parked
 * off-screen so their DOM, sockets and editor state survive while hidden.
 *
 * Extracted from Workspace.tsx's `renderTabPanel`, along with the
 * `keepMountedIds` subscription it depended on. Narrows the re-render blast
 * radius: a tab status change used to re-render all of Workspace (including
 * `executeNode`'s closure); now it re-renders only this component.
 *
 * Every panel stays a direct child in one keyed list, whether it fills the
 * outlet or sits on a side of a split, so going in and out of the split never
 * remounts an editor.
 */
export const TabOutlet: React.FC<TabOutletProps> = ({ context }) => {
  const tabs = useWorkspaceStore((state) => state.tabs);
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const tabSplit = useWorkspaceStore((state) => state.tabSplit);
  const activateTab = useWorkspaceStore((state) => state.activateTab);
  // Subscribed rather than read imperatively during render: a canvas that
  // starts running while inactive has to re-mount, and a getState() read
  // inside the render loop would never trigger that.
  const keepMountedIds = useWorkspaceStore(
    useShallow((state) =>
      state.tabs.filter((tab) => shouldKeepMounted(tab, state)).map((tab) => tab.id),
    ),
  );
  const outletRef = useRef<HTMLDivElement>(null);
  const { leftPercent, handle } = useSplitWidth(outletRef);

  const visibleIds = visibleTabIds(activeTabId, tabSplit);
  const split = visibleIds.length === 2 ? tabSplit : null;

  const paneProps = (tabId: string): React.HTMLAttributes<HTMLDivElement> => {
    if (!split) return {};
    const focus = () => {
      if (tabId !== activeTabId) activateTab(tabId);
    };
    const style = tabId === split.left ? { order: 0, flexGrow: 0, flexBasis: `${leftPercent}%` } : { order: 2 };
    return { style, onPointerDownCapture: focus, onFocusCapture: focus };
  };

  return (
    <div ref={outletRef} className={split ? `${styles.outlet} ${styles.split}` : styles.outlet}>
      {tabs.map((tab) => {
        const isVisible = visibleIds.includes(tab.id);
        // Tabs off screen unmount unless their policy says otherwise.
        const keepMounted = keepMountedIds.includes(tab.id);
        if (!isVisible && !keepMounted) return null;

        const surface = getTabView(tab.type).surface;
        const place = !isVisible ? styles.parked
          : !split ? styles.active
          : tab.id === activeTabId ? `${styles.pane} ${styles.paneFocused}`
          : styles.pane;

        return (
          <div
            key={tab.id}
            className={`${place} ${surface === "canvas" ? styles.canvasSurface : styles.editorSurface}`}
            {...(isVisible ? paneProps(tab.id) : {})}
          >
            <ErrorBoundary fallback={(error, reset) => <TabCrashFallback error={error} reset={reset} />}>
              <TabPanel tab={tab} isActive={isVisible} context={context} />
            </ErrorBoundary>
          </div>
        );
      })}
      {split && handle}
    </div>
  );
};
