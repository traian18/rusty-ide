import { describe, it, expect, vi, beforeEach } from "vitest";
import { createExplorerClient, type Invoke } from "./client";
import { createExplorerService, type ExplorerApp } from "./service";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  closeTab: vi.fn(),
  setFileTree: vi.fn(),
  loadGitStatus: vi.fn(),
  notify: vi.fn(),
  tabs: [] as { id: string; path: string }[],
}));

const app: ExplorerApp = {
  rootPath: () => "/workspace",
  setFileTree: mocks.setFileTree,
  loadGitStatus: mocks.loadGitStatus,
  setPathExpanded: vi.fn(),
  openFileTabs: () => mocks.tabs,
  closeTab: mocks.closeTab,
  tabIdForPath: (path) => `file:${path}`,
  setLastRename: vi.fn(),
  notify: mocks.notify,
  revealInFolder: vi.fn(),
};

const explorerService = createExplorerService(createExplorerClient(mocks.invoke as unknown as Invoke), app);

describe("explorer service delete operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue([]);
    mocks.loadGitStatus.mockResolvedValue(undefined);
    mocks.tabs = [
      { id: "file:/workspace/file1.ts", path: "/workspace/file1.ts" },
      { id: "file:/workspace/file2.ts", path: "/workspace/file2.ts" },
      { id: "file:/workspace/dir/nested.ts", path: "/workspace/dir/nested.ts" },
    ];
  });

  it("deletes a single item when confirmed and closes open tab", async () => {
    const confirmFn = vi.fn().mockResolvedValue(true);

    const result = await explorerService.deleteItems(
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

    const result = await explorerService.deleteItems(
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

    const result = await explorerService.deleteItems(
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

    const result = await explorerService.deleteItems(
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

    await explorerService.deleteItem(
      { path: "/workspace/file1.ts", name: "file1.ts", isDir: false },
      confirmFn
    );

    expect(mocks.invoke).toHaveBeenCalledWith("delete_file_or_dir", { path: "/workspace/file1.ts" });
    expect(mocks.closeTab).toHaveBeenCalledWith("file:/workspace/file1.ts");
  });
});
