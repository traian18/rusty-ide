import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  closeTab: vi.fn(),
  setFileTree: vi.fn(),
  loadGitStatus: vi.fn(),
  notify: vi.fn(),
  tabs: [] as any[],
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));
vi.mock("../../store", () => ({
  useWorkspaceStore: {
    getState: () => ({
      rootPath: "/workspace",
      tabs: mocks.tabs,
      closeTab: mocks.closeTab,
      setFileTree: mocks.setFileTree,
      loadGitStatus: mocks.loadGitStatus,
      setPathExpanded: vi.fn(),
    }),
  },
}));
vi.mock("../../notificationStore", () => ({ notify: mocks.notify }));

import { fileTreePresenter } from "./FileTreePresenter";

describe("FileTreePresenter delete operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue([]);
    mocks.loadGitStatus.mockResolvedValue(undefined);
    mocks.tabs = [
      { id: "file:/workspace/file1.ts", type: "file", path: "/workspace/file1.ts" },
      { id: "file:/workspace/file2.ts", type: "file", path: "/workspace/file2.ts" },
      { id: "file:/workspace/dir/nested.ts", type: "file", path: "/workspace/dir/nested.ts" },
      { id: "canvas_1", type: "canvas", canvasId: "canvas_1" },
    ];
  });

  it("deletes a single item when confirmed and closes open tab", async () => {
    const confirmFn = vi.fn().mockResolvedValue(true);

    const result = await fileTreePresenter.deleteItems(
      [{ path: "/workspace/file1.ts", name: "file1.ts", isDir: false }],
      confirmFn
    );

    expect(result).toBe(true);
    expect(confirmFn).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Confirm Delete",
        message: expect.stringContaining('"file1.ts"'),
        confirmLabel: "Delete",
      })
    );
    expect(mocks.invoke).toHaveBeenCalledWith("delete_file_or_dir", { path: "/workspace/file1.ts" });
    expect(mocks.closeTab).toHaveBeenCalledWith("file:/workspace/file1.ts");
    expect(mocks.notify).toHaveBeenCalledWith("Item Deleted", expect.stringContaining("file1.ts"), "success");
  });

  it("does not delete if confirmation is cancelled", async () => {
    const confirmFn = vi.fn().mockResolvedValue(false);

    const result = await fileTreePresenter.deleteItems(
      [{ path: "/workspace/file1.ts", name: "file1.ts", isDir: false }],
      confirmFn
    );

    expect(result).toBe(false);
    expect(mocks.invoke).not.toHaveBeenCalledWith("delete_file_or_dir", expect.anything());
    expect(mocks.closeTab).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("deletes multiple selected items, pluralizes confirmation, and closes all related tabs", async () => {
    const confirmFn = vi.fn().mockResolvedValue(true);

    const result = await fileTreePresenter.deleteItems(
      [
        { path: "/workspace/file1.ts", name: "file1.ts", isDir: false },
        { path: "/workspace/file2.ts", name: "file2.ts", isDir: false },
      ],
      confirmFn
    );

    expect(result).toBe(true);
    expect(confirmFn).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Confirm Delete (2 items)",
        message: expect.stringContaining("2 items"),
        confirmLabel: "Delete 2 Items",
      })
    );
    expect(mocks.invoke).toHaveBeenCalledWith("delete_file_or_dir", { path: "/workspace/file1.ts" });
    expect(mocks.invoke).toHaveBeenCalledWith("delete_file_or_dir", { path: "/workspace/file2.ts" });
    expect(mocks.closeTab).toHaveBeenCalledWith("file:/workspace/file1.ts");
    expect(mocks.closeTab).toHaveBeenCalledWith("file:/workspace/file2.ts");
    expect(mocks.notify).toHaveBeenCalledWith("Items Deleted", expect.stringContaining("2 items"), "success");
  });

  it("filters out nested items whose parent directory is also deleted", async () => {
    const confirmFn = vi.fn().mockResolvedValue(true);

    const result = await fileTreePresenter.deleteItems(
      [
        { path: "/workspace/dir", name: "dir", isDir: true },
        { path: "/workspace/dir/nested.ts", name: "nested.ts", isDir: false },
      ],
      confirmFn
    );

    expect(result).toBe(true);
    // Confirmation should only be for 1 item (the parent directory)
    expect(confirmFn).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Confirm Delete",
        message: expect.stringContaining('"dir"'),
      })
    );
    // Only the directory should be deleted via delete_file_or_dir
    expect(mocks.invoke).toHaveBeenCalledWith("delete_file_or_dir", { path: "/workspace/dir" });
    expect(mocks.invoke).not.toHaveBeenCalledWith("delete_file_or_dir", { path: "/workspace/dir/nested.ts" });

    // But open tabs for files inside the deleted directory SHOULD be closed
    expect(mocks.closeTab).toHaveBeenCalledWith("file:/workspace/dir/nested.ts");
  });

  it("deleteItem delegates to deleteItems properly", async () => {
    const confirmFn = vi.fn().mockResolvedValue(true);

    await fileTreePresenter.deleteItem(
      { path: "/workspace/file1.ts", name: "file1.ts", isDir: false },
      confirmFn
    );

    expect(mocks.invoke).toHaveBeenCalledWith("delete_file_or_dir", { path: "/workspace/file1.ts" });
    expect(mocks.closeTab).toHaveBeenCalledWith("file:/workspace/file1.ts");
  });
});
