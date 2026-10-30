// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ContextDrawerView } from "./ContextDrawer.view";

describe("Sidebar animation", () => {
  it("applies drawerClosing class when isClosing is true and handles onAnimationEnd", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const onAnimationEnd = vi.fn();

    try {
      // 1. When opening / open: isClosing is false
      await act(async () => {
        root.render(
          <ContextDrawerView
            drawerView="explorer"
            drawerWidth={300}
            fileTree={[]}
            isClosing={false}
            onAnimationEnd={onAnimationEnd}
            handleRefreshExplorer={() => {}}
            handleCollapseAllFolders={() => {}}
            handleCollapseDrawer={() => {}}
            onResizerMouseDown={() => {}}
            onResizerKeyDown={() => {}}
            onDrawerKeyDown={() => {}}
          />
        );
      });

      const drawerElement = container.firstElementChild as HTMLElement;
      expect(drawerElement).toBeTruthy();
      expect(drawerElement.className).toContain("drawer");
      expect(drawerElement.className).not.toContain("drawerClosing");

      // 2. When closing: isClosing is true
      await act(async () => {
        root.render(
          <ContextDrawerView
            drawerView="explorer"
            drawerWidth={300}
            fileTree={[]}
            isClosing={true}
            onAnimationEnd={onAnimationEnd}
            handleRefreshExplorer={() => {}}
            handleCollapseAllFolders={() => {}}
            handleCollapseDrawer={() => {}}
            onResizerMouseDown={() => {}}
            onResizerKeyDown={() => {}}
            onDrawerKeyDown={() => {}}
          />
        );
      });

      expect(drawerElement.className).toContain("drawerClosing");

      // 3. Dispatch animationend event
      await act(async () => {
        const event = new Event("animationend", { bubbles: true });
        const webkitEvent = new Event("webkitAnimationEnd", { bubbles: true });
        drawerElement.dispatchEvent(event);
        drawerElement.dispatchEvent(webkitEvent);
      });

      expect(onAnimationEnd).toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});
