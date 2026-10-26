import { afterEach, describe, expect, it, vi } from "vitest";

const openTab = vi.fn((request: { path: string }) => `file:${request.path}`);
const workspace = { activeTabId: "" };
vi.mock("../store", () => ({ useWorkspaceStore: { getState: () => ({ openTab, activeTabId: workspace.activeTabId }) } }));

import {
  currentNavigationHistory,
  EMPTY_HISTORY,
  MAX_LOCATIONS,
  navigate,
  noteCursor,
  noteMountedEditor,
  recordLocation,
  registerEditor,
  resetNavigationHistory,
  stepHistory,
  type EditorLocation,
} from "./navigationHistory";

const at = (path: string, line: number, column = 1): EditorLocation => ({ path, line, column });

describe("navigation history", () => {
  afterEach(() => {
    resetNavigationHistory();
    openTab.mockClear();
    vi.useRealTimers();
  });

  it("keeps a nearby cursor move as the same place and adds a jump as a new one", () => {
    let history = recordLocation(EMPTY_HISTORY, at("a.ts", 10));
    history = recordLocation(history, at("a.ts", 15));
    expect(history.entries).toEqual([at("a.ts", 15)]);
    history = recordLocation(history, at("a.ts", 200));
    history = recordLocation(history, at("b.ts", 3));
    expect(history.entries.map((entry) => `${entry.path}:${entry.line}`)).toEqual(["a.ts:15", "a.ts:200", "b.ts:3"]);
    expect(history.index).toBe(2);
  });

  it("goes back and forward, and a new jump after going back drops what was ahead", () => {
    let history = [at("a.ts", 1), at("b.ts", 1), at("c.ts", 1)].reduce(recordLocation, EMPTY_HISTORY);
    const back = stepHistory(history, -1);
    expect(back.target).toEqual(at("b.ts", 1));
    history = back.history;
    expect(stepHistory(history, 1).target).toEqual(at("c.ts", 1));
    history = recordLocation(history, at("d.ts", 1));
    expect(history.entries.map((entry) => entry.path)).toEqual(["a.ts", "b.ts", "d.ts"]);
    expect(stepHistory(history, 1).target).toBeUndefined();
  });

  it("stops at both ends and forgets the oldest places", () => {
    expect(stepHistory(EMPTY_HISTORY, -1).target).toBeUndefined();
    let history = EMPTY_HISTORY;
    for (let i = 0; i < MAX_LOCATIONS + 5; i += 1) history = recordLocation(history, at(`f${i}.ts`, 1));
    expect(history.entries).toHaveLength(MAX_LOCATIONS);
    expect(history.entries[0].path).toBe("f5.ts");
  });

  it("opens the earlier file, puts the cursor back, and ignores the moves that causes", () => {
    vi.useFakeTimers();
    const editor = { setPosition: vi.fn(), revealLineInCenterIfOutsideViewport: vi.fn(), focus: vi.fn() };
    registerEditor("file:a.ts", editor);
    noteCursor(at("a.ts", 40, 7));
    noteCursor(at("b.ts", 3));

    expect(navigate(-1)).toBe(true);
    expect(openTab).toHaveBeenCalledWith({ type: "file", path: "a.ts", line: 40, vfsTabId: undefined });
    expect(editor.setPosition).toHaveBeenCalledWith({ lineNumber: 40, column: 7 });

    // The arrival's own cursor event does not count as a new place.
    noteCursor(at("a.ts", 400));
    expect(currentNavigationHistory().entries).toHaveLength(2);
    vi.advanceTimersByTime(500);

    expect(navigate(1)).toBe(true);
    expect(openTab).toHaveBeenLastCalledWith({ type: "file", path: "b.ts", line: 3, vfsTabId: undefined });
    expect(navigate(1)).toBe(false);
  });

  it("counts a newly opened file as a place, so Back returns to the tab before it", () => {
    // Files opened from the explorer, never clicked in: only their editors mounting says where they are.
    workspace.activeTabId = "file:a.ts";
    noteMountedEditor("file:a.ts", at("a.ts", 1));
    workspace.activeTabId = "file:b.ts";
    noteMountedEditor("file:b.ts", at("b.ts", 1));
    // An editor mounting in a tab in the background is not where the person is.
    noteMountedEditor("file:c.ts", at("c.ts", 1));

    expect(currentNavigationHistory().entries.map((entry) => entry.path)).toEqual(["a.ts", "b.ts"]);
    expect(navigate(-1)).toBe(true);
    expect(openTab).toHaveBeenCalledWith({ type: "file", path: "a.ts", line: 1, vfsTabId: undefined });
    workspace.activeTabId = "";
  });
});
