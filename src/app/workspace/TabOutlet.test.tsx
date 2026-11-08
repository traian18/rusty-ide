// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "../../store";
import { duplicateTabId } from "../tabs/identity";
import type { TabInstance } from "../tabs/types";
import type { TabViewContext } from "../tabs/views";

const mounts = vi.hoisted(() => [] as string[]);

vi.mock("../tabs/views", () => ({
  TabIcon: () => null,
  getTabView: () => ({ surface: "editor" }),
  TabPanel: ({ tab, isActive }: { tab: TabInstance; isActive: boolean }) => {
    useEffect(() => {
      mounts.push(tab.id);
    }, [tab.id]);
    return <div data-panel={tab.id} data-active={String(isActive)} />;
  },
}));

import { TabOutlet } from "./TabOutlet";

const A = "file:/a.ts";
const COPY = duplicateTabId(A);
const file = (id: string): TabInstance => ({ id, type: "file", title: "a.ts", status: "idle", dirty: false, path: "/a.ts" });
const settings: TabInstance = { id: "settings", type: "settings", title: "Settings", status: "idle", dirty: false };

describe("TabOutlet", () => {
  let host: HTMLDivElement;
  let root: Root;

  const panel = (id: string) => host.querySelector<HTMLElement>(`[data-panel="${id}"]`);
  const pane = (id: string) => panel(id)!.parentElement!;
  const divider = () => host.querySelector('[role="separator"]');

  function show(state: Partial<ReturnType<typeof useWorkspaceStore.getState>>) {
    act(() => useWorkspaceStore.setState(state));
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    Element.prototype.scrollIntoView = vi.fn();
    mounts.length = 0;
    useWorkspaceStore.setState({ tabs: [file(A), file(COPY), settings], activeTabId: A, tabSplit: null });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(<TabOutlet context={{} as TabViewContext} />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    useWorkspaceStore.setState({ tabSplit: null });
  });

  it("shows only the active tab without a split", () => {
    expect(panel(A)).not.toBeNull();
    expect(panel(COPY)).toBeNull();
    expect(divider()).toBeNull();
  });

  it("shows both sides with a divider between them, each told it is visible", () => {
    show({ activeTabId: COPY, tabSplit: { left: A, right: COPY, focused: "right" } });

    expect(panel(A)?.dataset.active).toBe("true");
    expect(panel(COPY)?.dataset.active).toBe("true");
    expect(pane(A).style.order).toBe("0");
    expect(pane(COPY).style.order).toBe("2");
    expect(divider()).not.toBeNull();
  });

  it("does not remount the editor already on screen when the split opens", () => {
    show({ activeTabId: COPY, tabSplit: { left: A, right: COPY, focused: "right" } });
    expect(mounts).toEqual([A, COPY]);
  });

  it("sizes the left side from the divider and leaves the right the rest", () => {
    show({ activeTabId: A, tabSplit: { left: A, right: COPY, focused: "left" } });
    expect(pane(A).style.flexBasis).toBe("50%");
    // Growing as well would take half the remaining space on top of its share.
    expect(pane(A).style.flexGrow).toBe("0");
    expect(pane(COPY).style.flexBasis).toBe("");
  });

  it("makes the side the user clicks into active", () => {
    show({ activeTabId: COPY, tabSplit: { left: A, right: COPY, focused: "right" } });
    act(() => {
      pane(A).dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(useWorkspaceStore.getState().activeTabId).toBe(A);
    expect(useWorkspaceStore.getState().tabSplit?.focused).toBe("left");
  });

  it("moves settings with the accessible rail action without remounting the visible editor", () => {
    show({ activeTabId: COPY, tabSplit: { left: A, right: COPY, focused: "right", rails: { left: [A, "settings"], right: [COPY] } } });
    const action = host.querySelector<HTMLButtonElement>('[id="move-tab-left-settings"]')!;
    act(() => action.click());
    expect(useWorkspaceStore.getState().tabSplit?.rails?.right).toEqual([COPY, "settings"]);
    expect(panel("settings")).not.toBeNull();
    expect(mounts.filter((id) => id === A)).toHaveLength(1);
  });

  it("moves a dragged tab to the destination rail", () => {
    show({ activeTabId: COPY, tabSplit: { left: A, right: COPY, focused: "right", rails: { left: [A, "settings"], right: [COPY] } } });
    const target = host.querySelector('[data-tab-rail="right"]')!;
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { getData: () => "settings" } });
    act(() => target.dispatchEvent(drop));
    expect(useWorkspaceStore.getState().tabSplit?.rails?.right).toEqual([COPY, "settings"]);
    expect(useWorkspaceStore.getState().tabs.filter((tab) => tab.type === "settings")).toHaveLength(1);
  });

  it("renders two independent rails with settings beside a file", () => {
    show({ activeTabId: "settings", tabSplit: { left: A, right: "settings", focused: "right", rails: { left: [A, COPY], right: ["settings"] } } });
    expect(panel("settings")).not.toBeNull();
    expect(panel(A)).not.toBeNull();
    expect(panel(COPY)).toBeNull();
    expect(divider()).not.toBeNull();
    expect(host.querySelector('[data-tab-rail="left"] [data-tab-id="settings"]')).toBeNull();
    expect(host.querySelector('[data-tab-rail="right"] [data-tab-id="settings"]')).not.toBeNull();
  });
});
