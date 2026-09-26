import { describe, expect, it } from "vitest";
import {
  createTargetFor,
  flattenVisible,
  indexByPath,
  movablePaths,
  rangeSelection,
  resolveTreeKey,
  toggleInSelection,
  type FileEntry,
} from "./fileTreeModel";

const file = (path: string): FileEntry => ({ name: path.split("/").pop()!, path, is_dir: false });
const dir = (path: string, children: FileEntry[]): FileEntry => ({ name: path.split("/").pop()!, path, is_dir: true, children });

const TREE: FileEntry[] = [
  dir("/ws/src", [dir("/ws/src/lib", [file("/ws/src/lib/util.ts")]), file("/ws/src/main.ts")]),
  file("/ws/README.md"),
];

const paths = (entries: FileEntry[]) => entries.map((entry) => entry.path);

describe("flattenVisible", () => {
  it("lists only root entries when nothing is expanded", () => {
    expect(paths(flattenVisible(TREE, {}))).toEqual(["/ws/src", "/ws/README.md"]);
  });

  it("includes children of expanded folders in on-screen order", () => {
    expect(paths(flattenVisible(TREE, { "/ws/src": true, "/ws/src/lib": true }))).toEqual([
      "/ws/src",
      "/ws/src/lib",
      "/ws/src/lib/util.ts",
      "/ws/src/main.ts",
      "/ws/README.md",
    ]);
  });

  it("hides children of a collapsed folder even when a nested folder is expanded", () => {
    expect(paths(flattenVisible(TREE, { "/ws/src/lib": true }))).toEqual(["/ws/src", "/ws/README.md"]);
  });
});

describe("indexByPath", () => {
  it("indexes collapsed descendants too", () => {
    expect(indexByPath(TREE).get("/ws/src/lib/util.ts")?.name).toBe("util.ts");
  });
});

describe("resolveTreeKey", () => {
  const expanded = { "/ws/src": true };
  const visible = flattenVisible(TREE, expanded); // src, src/lib, src/main.ts, README.md
  const key = (k: string, focusedPath: string | null, mods: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean } = {}) =>
    resolveTreeKey({ key: k, ...mods }, { visible, focusedPath, expanded });

  it("ArrowDown/ArrowUp start at the first row when nothing is focused", () => {
    expect(key("ArrowDown", null)).toEqual({ type: "focus", path: "/ws/src", extend: false });
    expect(key("ArrowUp", null)).toEqual({ type: "focus", path: "/ws/src", extend: false });
  });

  it("ArrowDown/ArrowUp move one visible row and clamp at the ends", () => {
    expect(key("ArrowDown", "/ws/src")).toEqual({ type: "focus", path: "/ws/src/lib", extend: false });
    expect(key("ArrowUp", "/ws/src/main.ts")).toEqual({ type: "focus", path: "/ws/src/lib", extend: false });
    expect(key("ArrowDown", "/ws/README.md")).toEqual({ type: "focus", path: "/ws/README.md", extend: false });
    expect(key("ArrowUp", "/ws/src")).toEqual({ type: "focus", path: "/ws/src", extend: false });
  });

  it("Shift+Arrow extends the selection", () => {
    expect(key("ArrowDown", "/ws/src", { shiftKey: true })).toEqual({ type: "focus", path: "/ws/src/lib", extend: true });
  });

  it("ArrowRight expands a collapsed folder, then steps into an expanded one", () => {
    expect(key("ArrowRight", "/ws/src/lib")).toEqual({ type: "expand", path: "/ws/src/lib", open: true });
    expect(key("ArrowRight", "/ws/src")).toEqual({ type: "focus", path: "/ws/src/lib", extend: false });
    expect(key("ArrowRight", "/ws/README.md")).toBeNull();
  });

  it("ArrowLeft collapses an expanded folder, otherwise jumps to the parent folder", () => {
    expect(key("ArrowLeft", "/ws/src")).toEqual({ type: "expand", path: "/ws/src", open: false });
    expect(key("ArrowLeft", "/ws/src/main.ts")).toEqual({ type: "focus", path: "/ws/src", extend: false });
    expect(key("ArrowLeft", "/ws/README.md")).toBeNull();
  });

  it("Enter activates, Space selects (Cmd/Ctrl toggles)", () => {
    expect(key("Enter", "/ws/src/main.ts")).toEqual({ type: "activate", entry: visible[2] });
    expect(key(" ", "/ws/src/main.ts")).toEqual({ type: "select", path: "/ws/src/main.ts", toggle: false });
    expect(key(" ", "/ws/src/main.ts", { metaKey: true })).toEqual({ type: "select", path: "/ws/src/main.ts", toggle: true });
  });

  it("Delete and Cmd/Ctrl+Backspace delete; plain Backspace and other keys are ignored", () => {
    expect(key("Delete", "/ws/src")).toEqual({ type: "delete" });
    expect(key("Backspace", "/ws/src", { ctrlKey: true })).toEqual({ type: "delete" });
    expect(key("Backspace", "/ws/src")).toBeNull();
    expect(key("a", "/ws/src")).toBeNull();
  });

  it("ignores keys when the tree is empty", () => {
    expect(resolveTreeKey({ key: "ArrowDown" }, { visible: [], focusedPath: null, expanded: {} })).toBeNull();
  });
});

describe("selection helpers", () => {
  const visible = flattenVisible(TREE, { "/ws/src": true });

  it("rangeSelection covers every visible row between two paths, in either direction", () => {
    expect([...rangeSelection(visible, "/ws/README.md", "/ws/src/lib")!]).toEqual(["/ws/src/lib", "/ws/src/main.ts", "/ws/README.md"]);
    expect(rangeSelection(visible, "/ws/src", "/ws/src/lib/util.ts")).toBeNull();
  });

  it("toggleInSelection adds and removes without mutating the input", () => {
    const start = new Set(["/a"]);
    expect([...toggleInSelection(start, "/b")]).toEqual(["/a", "/b"]);
    expect([...toggleInSelection(start, "/a")]).toEqual([]);
    expect([...start]).toEqual(["/a"]);
  });
});

describe("movablePaths", () => {
  it("drops duplicates, nested paths, the destination and its ancestors", () => {
    expect(movablePaths(["/ws/src", "/ws/src/main.ts", "/ws/src", "/ws/README.md", "/ws/docs"], "/ws/docs")).toEqual(["/ws/src", "/ws/README.md"]);
    expect(movablePaths(["/ws/src"], "/ws/src/lib")).toEqual([]);
  });
});

describe("createTargetFor", () => {
  it("creates inside a folder, or next to a file", () => {
    expect(createTargetFor(TREE[0])).toEqual({ dir: "/ws/src", name: "src" });
    expect(createTargetFor(file("/ws/src/main.ts"))).toEqual({ dir: "/ws/src", name: "src" });
  });
});
