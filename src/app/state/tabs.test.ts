import { describe, expect, it, vi } from "vitest";
import { createTabTestStore } from "../../test/tabTestStore";
import { duplicateTabId, fileTabIdentity, originalTabId } from "../tabs/identity";
import { visibleTabIds } from "../tabs/split";

/**
 * Successor to createEditorSlice.test.ts.
 *
 * Every case PR 0 marked `KNOWN-WRONG (PR 1)` is dispositioned here: flipped to
 * the corrected behavior, deleted because the concept is gone (editor groups,
 * split, move), or kept and relabelled where the old behavior turned out to be
 * the right one. Nothing was dropped silently.
 */

function canvasContext(overrides: Record<string, unknown> = {}) {
  return {
    nodes: [],
    edges: [],
    nodeLogs: {},
    nodeStatus: {},
    globalChatHistory: {},
    edgeReconciliationStatus: {},
    ...overrides,
  } as never;
}

describe("initial state", () => {
  it("opens onboarding and workspace, with onboarding active", () => {
    const store = createTabTestStore();
    const state = store.getState();

    expect(state.tabs.map((tab) => tab.type)).toEqual(["onboarding", "workspace"]);
    expect(state.activeTabId).toBe("onboarding");
  });

  it("identifies singleton tabs by their type", () => {
    for (const tab of createTabTestStore().getState().tabs) {
      expect(tab.id).toBe(tab.type);
    }
  });
});

describe("openTab: global singletons", () => {
  // Was six types; `metrics` and `agent` are included now. Both duplicated
  // before, because the singleton list was a hard-coded array that omitted
  // metrics entirely and agent creation bypassed openTab altogether.
  it.each([
    "onboarding",
    "workspace",
    "settings",
    "llm-setup",
    "skills",
    "behaviors",
    "mcp-integration",
    "metrics",
    "architecture",
    "docs",
    "agent",
  ] as const)("opens only one %s tab across repeated calls", (type) => {
    const store = createTabTestStore();
    const first = store.getState().openTab({ type });
    const second = store.getState().openTab({ type });

    expect(first).toBe(second);
    expect(store.getState().tabs.filter((tab) => tab.type === type)).toHaveLength(1);
  });

  it("activates the existing tab instead of creating another", () => {
    const store = createTabTestStore();
    store.getState().openTab({ type: "settings" });
    store.getState().openTab({ type: "metrics" });
    store.getState().openTab({ type: "settings" });

    expect(store.getState().activeTabId).toBe("settings");
  });

  it("returns the id of the tab it opened or focused", () => {
    const store = createTabTestStore();
    expect(store.getState().openTab({ type: "settings" })).toBe("settings");
  });
});

describe("openTab: file identity", () => {
  it("opens two tabs for two different files", () => {
    const store = createTabTestStore();
    store.getState().openTab({ type: "file", path: "/a.ts" });
    store.getState().openTab({ type: "file", path: "/b.ts" });

    expect(store.getState().tabs.filter((tab) => tab.type === "file")).toHaveLength(2);
  });

  it("resolves relative, absolute and normalized references to one tab", () => {
    // This is the headline fix: the file tree used one id scheme and
    // go-to-definition another, so opening a file from two entry points used
    // to produce two tabs for the same file.
    const store = createTabTestStore({ rootPath: "/root" } as never);
    const first = store.getState().openTab({ type: "file", path: "/root/src/a.ts" });
    const second = store.getState().openTab({ type: "file", path: "src/a.ts" });
    const third = store.getState().openTab({ type: "file", path: "src/../src/a.ts" });

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(store.getState().tabs.filter((tab) => tab.type === "file")).toHaveLength(1);
  });

  it("stores a canonical, case-preserving path", () => {
    const store = createTabTestStore();
    const id = store.getState().openTab({ type: "file", path: "\\A\\b.ts" });
    const tab = store.getState().tabs.find((candidate) => candidate.id === id);

    expect(tab).toMatchObject({ type: "file", path: "/A/b.ts" });
  });

  it("uses the shared identity helper, so call sites and the store agree", () => {
    const store = createTabTestStore();
    const id = store.getState().openTab({ type: "file", path: "/a.ts" });
    expect(id).toBe(fileTabIdentity("/a.ts"));
  });

  it("reopening with an explicit line updates it and activates the tab", () => {
    const store = createTabTestStore();
    store.getState().openTab({ type: "file", path: "/a.ts", line: 10 });
    store.getState().openTab({ type: "settings" });
    const id = store.getState().openTab({ type: "file", path: "/a.ts", line: 42 });

    expect(store.getState().activeTabId).toBe(id);
    expect(store.getState().tabs.find((tab) => tab.id === id)).toMatchObject({ line: 42 });
  });

  it("reopening without a line keeps the previous one", () => {
    // Kept from PR 0, but no longer marked wrong: reopening an already-open
    // file from the tree should not yank the caret back to line 1.
    const store = createTabTestStore();
    store.getState().openTab({ type: "file", path: "/a.ts", line: 10 });
    const id = store.getState().openTab({ type: "file", path: "/a.ts" });

    expect(store.getState().tabs.find((tab) => tab.id === id)).toMatchObject({ line: 10 });
  });
});

describe("openTab: canvas", () => {
  it("allocates distinct ids for successive canvases", () => {
    const store = createTabTestStore();
    const first = store.getState().openTab({ type: "canvas" });
    const second = store.getState().openTab({ type: "canvas" });

    expect(first).not.toBe(second);
    expect(store.getState().tabs.filter((tab) => tab.type === "canvas")).toHaveLength(2);
  });

  it("reopens a saved canvas by id rather than duplicating it", () => {
    const store = createTabTestStore();
    const first = store.getState().openTab({ type: "canvas", canvasId: "canvas_7" });
    const second = store.getState().openTab({ type: "canvas", canvasId: "canvas_7" });

    expect(second).toBe(first);
    expect(store.getState().tabs.filter((tab) => tab.type === "canvas")).toHaveLength(1);
  });

  it("seeds a context and history for a new canvas, and only on create", () => {
    const store = createTabTestStore();
    const id = store.getState().openTab({ type: "canvas" });
    store.getState().updateCanvasContext?.(id, { hasBeenSaved: true });

    store.setState({
      canvasContexts: { [id]: canvasContext({ nodes: [{ id: "n" }] }) },
    } as never);
    store.getState().openTab({ type: "canvas", canvasId: id });

    expect(store.getState().canvasContexts[id].nodes).toHaveLength(1);
  });

  it("does not seed canvas state when opening a non-canvas tab", () => {
    // openTab used to materialize an empty `canvasContexts.canvas` entry by
    // mutating state in place, even for a file tab.
    const store = createTabTestStore();
    const before = store.getState().canvasContexts;
    store.getState().openTab({ type: "file", path: "/a.ts" });

    expect(store.getState().canvasContexts).toEqual(before);
    expect(store.getState().canvasContexts).not.toHaveProperty("canvas");
  });
});

describe("openTab: git tabs are repository-scoped", () => {
  it("separates the same file's diff across two repositories", () => {
    const store = createTabTestStore();
    const a = store.getState().openTab({
      type: "git-diff",
      repoPath: "/repo-a",
      path: "/x/a.ts",
      diffType: "unstaged",
    });
    const b = store.getState().openTab({
      type: "git-diff",
      repoPath: "/repo-b",
      path: "/x/a.ts",
      diffType: "unstaged",
    });

    expect(a).not.toBe(b);
  });

  it("separates staged from unstaged diffs of one file", () => {
    const store = createTabTestStore();
    const staged = store.getState().openTab({
      type: "git-diff",
      repoPath: "/repo",
      path: "/a.ts",
      diffType: "staged",
    });
    const unstaged = store.getState().openTab({
      type: "git-diff",
      repoPath: "/repo",
      path: "/a.ts",
      diffType: "unstaged",
    });

    expect(staged).not.toBe(unstaged);
  });

  it("separates repo-wide history from file history", () => {
    const store = createTabTestStore();
    const repoWide = store.getState().openTab({ type: "git-history", repoPath: "/repo" });
    const fileScoped = store
      .getState()
      .openTab({ type: "git-history", repoPath: "/repo", path: "/a.ts" });

    expect(repoWide).not.toBe(fileScoped);
  });
});

describe("activateTab", () => {
  it("activates an existing tab", () => {
    const store = createTabTestStore();
    store.getState().activateTab("workspace");
    expect(store.getState().activeTabId).toBe("workspace");
  });

  it("ignores an unknown tab id", () => {
    // Previously accepted any string, leaving activeTabId dangling.
    const store = createTabTestStore();
    store.getState().activateTab("no_such_tab");
    expect(store.getState().activeTabId).toBe("onboarding");
  });
});

describe("closeTab", () => {
  function threeTabs() {
    const store = createTabTestStore();
    store.getState().openTab({ type: "file", path: "/a.ts" });
    store.getState().openTab({ type: "file", path: "/b.ts" });
    store.getState().openTab({ type: "file", path: "/c.ts" });
    return store;
  }

  it("removes the tab", () => {
    const store = createTabTestStore();
    const id = store.getState().openTab({ type: "file", path: "/a.ts" });
    store.getState().closeTab(id);

    expect(store.getState().tabs.find((tab) => tab.id === id)).toBeUndefined();
  });

  it("selects the neighbour to the right when closing the active tab", () => {
    // Previously fell back to the LAST tab in the strip, throwing focus across
    // the window when closing anything but the rightmost tab.
    const store = threeTabs();
    const b = fileTabIdentity("/b.ts");
    store.getState().activateTab(b);
    store.getState().closeTab(b);

    expect(store.getState().activeTabId).toBe(fileTabIdentity("/c.ts"));
  });

  it("falls back to the left when closing the last tab in the strip", () => {
    const store = threeTabs();
    const c = fileTabIdentity("/c.ts");
    store.getState().activateTab(c);
    store.getState().closeTab(c);

    expect(store.getState().activeTabId).toBe(fileTabIdentity("/b.ts"));
  });

  it("leaves the active tab alone when closing an inactive one", () => {
    const store = threeTabs();
    const c = fileTabIdentity("/c.ts");
    store.getState().activateTab(c);
    store.getState().closeTab(fileTabIdentity("/a.ts"));

    expect(store.getState().activeTabId).toBe(c);
  });

  it("closing the first tab selects its right neighbour", () => {
    const store = createTabTestStore();
    store.getState().activateTab("onboarding");
    store.getState().closeTab("onboarding");

    expect(store.getState().activeTabId).toBe("workspace");
  });

  it("replaces the only tab with a fresh onboarding tab when onboarding has not been seen", () => {
    // Generalizes the old special case that made `workspace_select`
    // unclosable: the guarantee is "never leave the user with nothing", which
    // now holds for whichever tab happens to be last.
    const store = createTabTestStore();
    store.getState().closeTab("onboarding");
    store.getState().closeTab("workspace");

    const state = store.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]).toMatchObject({ id: "onboarding", type: "onboarding" });
    expect(state.activeTabId).toBe("onboarding");
  });

  it("replaces the only tab with a workspace tab when onboarding has been seen", () => {
    const memory = new Map<string, string>([["rusty_has_seen_onboarding", "true"]]);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => memory.set(k, v),
    });

    const store = createTabTestStore();
    store.getState().closeTab("onboarding");
    store.getState().closeTab("workspace");

    const state = store.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]).toMatchObject({ id: "workspace", type: "workspace" });
    expect(state.activeTabId).toBe("workspace");

    vi.unstubAllGlobals();
  });

  it("closing an onboarding tab marks onboarding as seen", () => {
    const memory = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => memory.set(k, v),
    });

    const store = createTabTestStore();
    store.getState().closeTab("onboarding");

    expect(memory.get("rusty_has_seen_onboarding")).toBe("true");

    vi.unstubAllGlobals();
  });

  it("ignores an unknown tab id", () => {
    const store = createTabTestStore();
    const before = store.getState().tabs;
    store.getState().closeTab("no_such_tab");

    expect(store.getState().tabs).toBe(before);
  });

  it("prunes the closed canvas's context and history", () => {
    const store = createTabTestStore();
    const kept = store.getState().openTab({ type: "canvas" });
    const closed = store.getState().openTab({ type: "canvas" });
    store.getState().closeTab(closed);

    const state = store.getState();
    expect(state.canvasContexts).not.toHaveProperty(closed);
    expect(state.canvasHistories).not.toHaveProperty(closed);
    expect(state.canvasContexts).toHaveProperty(kept);
  });

  it("does not leak canvas state between canvas tabs", () => {
    const store = createTabTestStore();
    const first = store.getState().openTab({ type: "canvas" });
    const second = store.getState().openTab({ type: "canvas" });

    store.setState({
      canvasContexts: {
        ...store.getState().canvasContexts,
        [first]: canvasContext({ nodes: [{ id: "first-node" }] }),
        [second]: canvasContext({ nodes: [{ id: "second-node" }] }),
      },
    } as never);
    store.getState().closeTab(second);

    expect(store.getState().canvasContexts[first].nodes).toEqual([{ id: "first-node" }]);
    expect(store.getState().canvasContexts).not.toHaveProperty(second);
  });

  it("prunes all three agent maps", () => {
    const store = createTabTestStore();
    const id = store.getState().openTab({ type: "agent" });
    store.setState({
      agentStreams: { [id]: "partial" },
      agentPermissionRequests: { [id]: [] },
    } as never);

    store.getState().closeTab(id);

    const state = store.getState();
    expect(state.agentChats).not.toHaveProperty(id);
    expect(state.agentStreams).not.toHaveProperty(id);
    expect(state.agentPermissionRequests).not.toHaveProperty(id);
  });
});

describe("updateTab", () => {
  it("updates the named tab's title", () => {
    const store = createTabTestStore();
    const id = store.getState().openTab({ type: "canvas", title: "Draft" });
    store.getState().updateTab(id, { title: "Renamed" });

    expect(store.getState().tabs.find((tab) => tab.id === id)?.title).toBe("Renamed");
  });

  it("leaves other tabs untouched", () => {
    // updateTabTitle used to rename by id across every editor group, so a tab
    // duplicated into two panes was renamed in both.
    const store = createTabTestStore();
    const id = store.getState().openTab({ type: "canvas", title: "Draft" });
    store.getState().updateTab(id, { title: "Renamed" });

    expect(store.getState().tabs.find((tab) => tab.type === "onboarding")?.title).toBe(
      "Welcome to Rusty",
    );
  });

  it("ignores an unknown tab id", () => {
    const store = createTabTestStore();
    const before = store.getState().tabs;
    store.getState().updateTab("no_such_tab", { title: "x" });

    expect(store.getState().tabs).toBe(before);
  });
});

describe("canvas alias syncing", () => {
  it("republishes the active canvas's nodes when switching canvas tabs", () => {
    const store = createTabTestStore();
    const first = store.getState().openTab({ type: "canvas" });
    const second = store.getState().openTab({ type: "canvas" });

    store.setState({
      canvasContexts: {
        ...store.getState().canvasContexts,
        [first]: canvasContext({ nodes: [{ id: "first-node" }] }),
        [second]: canvasContext({ nodes: [{ id: "second-node" }] }),
      },
    } as never);

    store.getState().activateTab(first);
    expect(store.getState().nodes).toEqual([{ id: "first-node" }]);

    store.getState().activateTab(second);
    expect(store.getState().nodes).toEqual([{ id: "second-node" }]);
  });
});

describe("hydrateTabs", () => {
  it("leaves onboarding and workspace tabs on first run and marks onboarding as seen", () => {
    const memory = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => memory.set(k, v),
    });

    const store = createTabTestStore();
    store.getState().hydrateTabs();

    const state = store.getState();
    expect(state.tabs.map((tab) => tab.type)).toEqual(["onboarding", "workspace"]);
    expect(state.activeTabId).toBe("onboarding");
    expect(memory.get("rusty_has_seen_onboarding")).toBe("true");

    vi.unstubAllGlobals();
  });

  it("switches to workspace tab as default when onboarding has already been seen", () => {
    const memory = new Map<string, string>([["rusty_has_seen_onboarding", "true"]]);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => memory.set(k, v),
    });

    const store = createTabTestStore();
    store.getState().hydrateTabs();

    const state = store.getState();
    expect(state.tabs.map((tab) => tab.type)).toEqual(["workspace"]);
    expect(state.activeTabId).toBe("workspace");

    vi.unstubAllGlobals();
  });

  it("does not override tabs if user has already opened other tabs before hydrate", () => {
    const memory = new Map<string, string>([["rusty_has_seen_onboarding", "true"]]);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => memory.set(k, v),
    });

    const store = createTabTestStore();
    store.getState().openTab({ type: "settings" });
    store.getState().hydrateTabs();

    expect(store.getState().tabs.some((t) => t.type === "settings")).toBe(true);

    vi.unstubAllGlobals();
  });
});

describe("side-by-side code tabs", () => {
  const A = fileTabIdentity("/a.ts");
  const COPY = duplicateTabId(A);
  const ids = (store: ReturnType<typeof createTabTestStore>) => store.getState().tabs.map((tab) => tab.id);

  function splitOnA() {
    const store = createTabTestStore();
    store.getState().openTab({ type: "file", path: "/a.ts" });
    store.getState().toggleSplit();
    return store;
  }

  it("opens the active code tab beside a copy of itself", () => {
    const store = splitOnA();
    expect(ids(store)).toEqual(["onboarding", "workspace", A, COPY]);
    expect(store.getState().activeTabId).toBe(COPY);
    expect(store.getState().tabSplit).toMatchObject({ left: A, right: COPY, focused: "right" });
  });

  it.each(["agent", "settings", "workspace"] as const)("does not duplicate a %s tab", (type) => {
    const store = createTabTestStore();
    store.getState().openTab({ type });
    const before = ids(store);
    store.getState().toggleSplit();
    expect(ids(store)).toEqual(before);
    expect(store.getState().tabSplit?.right).toBe(type);
  });

  it("does not duplicate a canvas tab", () => {
    const store = createTabTestStore();
    const id = store.getState().openTab({ type: "canvas" });
    store.getState().toggleSplit();
    expect(store.getState().tabSplit?.right).toBe(id);
    expect(store.getState().tabs.filter((tab) => tab.type === "canvas")).toHaveLength(1);
  });

  it("never makes a third tab of a file", () => {
    const store = splitOnA();
    store.getState().toggleSplit();
    store.getState().toggleSplit();
    expect(ids(store).filter((id) => originalTabId(id) === A)).toHaveLength(2);
  });

  it.each(["left", "right"] as const)("deduplicates file moves into the %s rail", (side) => {
    const store = splitOnA();
    const moved = side === "left" ? COPY : A;
    const retained = side === "left" ? A : COPY;
    store.getState().moveTabToRail(moved, side);
    expect(ids(store)).not.toContain(moved);
    expect(ids(store)).toContain(retained);
    expect(store.getState().activeTabId).toBe(retained);
    if (side === "left") expect(store.getState().tabSplit).toBeNull();
  });

  it("moves singleton tabs without duplication and keeps reopening in their owning rail", () => {
    const store = splitOnA();
    store.getState().openTab({ type: "settings" });
    store.getState().moveTabToRail("settings", "left", 0);
    expect(store.getState().tabSplit?.rails?.left[0]).toBe("settings");
    store.getState().activateTab(COPY);
    store.getState().openTab({ type: "settings" });
    expect(store.getState().tabSplit?.focused).toBe("left");
    expect(ids(store).filter((id) => id === "settings")).toHaveLength(1);
  });

  it("keeps opening a file in the copy that is in use", () => {
    const store = splitOnA();
    const opened = store.getState().openTab({ type: "file", path: "/a.ts", line: 40 });
    expect(opened).toBe(COPY);
    expect(store.getState().activeTabId).toBe(COPY);
    const copy = store.getState().tabs.find((tab) => tab.id === COPY);
    expect(copy).toMatchObject({ line: 40 });
    const original = store.getState().tabs.find((tab) => tab.id === A);
    expect(original).not.toHaveProperty("line", 40);
  });

  it("opens another file on the focused side", () => {
    const store = splitOnA();
    const b = store.getState().openTab({ type: "file", path: "/b.ts" });
    expect(store.getState().tabSplit).toMatchObject({ left: A, right: b, focused: "right" });
    store.getState().activateTab(A);
    const c = store.getState().openTab({ type: "file", path: "/c.ts" });
    expect(store.getState().tabSplit).toMatchObject({ left: c, right: b, focused: "left" });
  });

  it("shows settings beside a file and retains independent selections", () => {
    const store = splitOnA();
    store.getState().openTab({ type: "settings" });
    expect(store.getState().tabSplit).toMatchObject({ left: A, right: "settings", focused: "right" });
    expect(visibleTabIds(store.getState().activeTabId, store.getState().tabSplit)).toEqual([A, "settings"]);
    store.getState().activateTab(A);
    expect(visibleTabIds(store.getState().activeTabId, store.getState().tabSplit)).toEqual([A, "settings"]);
    store.getState().activateTab(COPY);
    expect(store.getState().tabSplit?.right).toBe(COPY);
  });

  it("merges rails when closing split with settings selected", () => {
    const store = splitOnA();
    store.getState().openTab({ type: "settings" });
    store.getState().toggleSplit();
    expect(store.getState().tabSplit).toBeNull();
    expect(store.getState().activeTabId).toBe("settings");
    expect(ids(store).filter((id) => originalTabId(id) === A)).toHaveLength(1);
  });

  it("ends the split when a side closes, moving focus to the other side", () => {
    const store = splitOnA();
    store.getState().closeTab(COPY);
    expect(store.getState().tabSplit).toBeNull();
    expect(store.getState().activeTabId).toBe(A);

    const other = splitOnA();
    other.getState().closeTab(A);
    expect(other.getState().tabSplit).not.toBeNull();
    expect(other.getState().tabSplit?.rails?.left).toEqual(["onboarding", "workspace"]);
    expect(other.getState().activeTabId).toBe(COPY);
  });

  it("keeps focus when the unfocused side closes", () => {
    const store = splitOnA();
    store.getState().closeTab(A);
    expect(store.getState().activeTabId).toBe(COPY);
  });

  it("merges duplicate files when the split closes, preserving the selected instance", () => {
    const store = splitOnA();
    store.getState().toggleSplit();
    expect(store.getState().tabSplit).toBeNull();
    expect(ids(store)).toEqual(["onboarding", "workspace", COPY]);
    expect(store.getState().activeTabId).toBe(COPY);
  });

  it("keeps both tabs when the split held two different files", () => {
    const store = splitOnA();
    const b = store.getState().openTab({ type: "file", path: "/b.ts" });
    store.getState().closeTab(COPY);
    store.getState().toggleSplit();
    const copyOfB = duplicateTabId(b);
    const c = store.getState().openTab({ type: "file", path: "/c.ts" });
    store.getState().closeTab(copyOfB);
    expect(store.getState().tabSplit).toBeNull();
    expect(ids(store)).toEqual(expect.arrayContaining([A, b, c]));
  });

  it("leaves two different files open when the split closes", () => {
    const store = splitOnA();
    const b = store.getState().openTab({ type: "file", path: "/b.ts" });
    store.getState().toggleSplit();
    expect(store.getState().tabSplit).toBeNull();
    expect(ids(store)).toEqual(expect.arrayContaining([A, b]));
    expect(store.getState().activeTabId).toBe(b);
  });

  it("pulls the tab that replaces a closed non-code tab onto the focused side", () => {
    const store = splitOnA();
    store.getState().openTab({ type: "settings" });
    const b = store.getState().openTab({ type: "file", path: "/b.ts" });
    store.getState().openTab({ type: "skills" });
    store.getState().closeTab("skills");
    expect(store.getState().activeTabId).toBe(b);
    expect(visibleTabIds(store.getState().activeTabId, store.getState().tabSplit)).toEqual([A, b]);
  });
});
