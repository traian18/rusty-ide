import React from "react";
import { Header } from "../Header";
import { NavigationRail } from "../navigation/NavigationRail";
import { ContextDrawer } from "../drawer/ContextDrawer";
import { MainWorkspace } from "../workspace/MainWorkspace";
import { SearchPalette } from "../SearchPalette";
import { ToolExecutionPanel } from "../observability/ToolExecutionPanel";
import { RuntimeDownloadProgress } from "../integrations/RuntimeDownloadProgress";
import styles from "./AppShell.module.css";

interface AppShellViewProps {
  searchOpen: boolean;
  onSearchOpen: () => void;
  onSearchClose: () => void;
  toolExecutionOpen: boolean;
  onToolExecutionToggle: () => void;
  onToolExecutionClose: () => void;
  drawerMounted: boolean;
  drawerClosing: boolean;
  onDrawerAnimationEnd: (e: React.AnimationEvent) => void;
  onDrawerResizeMouseDown: (e: React.MouseEvent) => void;
  drawerElementRef: React.RefObject<HTMLDivElement | null>;
}

export const AppShellView: React.FC<AppShellViewProps> = ({
  searchOpen,
  onSearchOpen,
  onSearchClose,
  toolExecutionOpen,
  onToolExecutionToggle,
  onToolExecutionClose,
  drawerMounted,
  drawerClosing,
  onDrawerAnimationEnd,
  onDrawerResizeMouseDown,
  drawerElementRef,
}) => (
  <>
    <Header
      onSearchOpen={onSearchOpen}
      toolExecutionOpen={toolExecutionOpen}
      onToolExecutionToggle={onToolExecutionToggle}
    />

    <div className={styles.workbench}>
      <NavigationRail />

      {/*
        The single shell card. `overflow: hidden` is what lets the rail's
        right-placed tooltips escape into the gutter (it sits outside this
        element) while still clipping the drawer and workspace to one
        rounded rectangle -- see NavigationRail.module.css's matching note.
      */}
      <div className={styles.surface}>
        {drawerMounted && (
          <ContextDrawer
            containerRef={drawerElementRef}
            isClosing={drawerClosing}
            onAnimationEnd={onDrawerAnimationEnd}
            onResizerMouseDown={onDrawerResizeMouseDown}
          />
        )}
        <MainWorkspace />
      </div>
    </div>

    <RuntimeDownloadProgress />
    {searchOpen && <SearchPalette onClose={onSearchClose} />}
    {toolExecutionOpen && <ToolExecutionPanel onClose={onToolExecutionClose} />}
  </>
);
