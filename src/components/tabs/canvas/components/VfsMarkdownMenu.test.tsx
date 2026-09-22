// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VfsMarkdownMenu } from "./VfsMarkdownMenu";
import { VfsRegistry } from "../../../../services/vfs";
import { useWorkspaceStore } from "../../../../store";

let root: Root;
let container: HTMLDivElement;

describe("VfsMarkdownMenu", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders the toggle button with MD Files text and file count badge", async () => {
    const tabId = "canvas-test-1";
    const vfs = VfsRegistry.getOrCreate(tabId);
    vi.spyOn(vfs, "snapshot").mockResolvedValue({
      contents: {
        "/workspace/README.md": "# Readme",
        "/workspace/plan.markdown": "# Plan",
        "/workspace/code.ts": "console.log('hi');",
      },
      tracker: {},
    });
    vi.spyOn(vfs, "getAllNodeFiles").mockResolvedValue([
      { node_id: "node-1", files: ["/workspace/notes.md"] },
    ]);

    await act(async () => {
      root.render(
        <VfsMarkdownMenu
          tabId={tabId}
          isOpen={false}
          onToggle={vi.fn()}
          onClose={vi.fn()}
        />
      );
    });

    expect(container.textContent).toContain("MD Files");
    // Should discover 3 unique MD files: README.md, plan.markdown, notes.md
    expect(container.textContent).toContain("3");
  });

  it("shows empty state when no MD files are tracked in VFS", async () => {
    const tabId = "canvas-test-empty";
    const vfs = VfsRegistry.getOrCreate(tabId);
    vi.spyOn(vfs, "snapshot").mockResolvedValue({ contents: {}, tracker: {} });
    vi.spyOn(vfs, "getAllNodeFiles").mockResolvedValue([]);

    await act(async () => {
      root.render(
        <VfsMarkdownMenu
          tabId={tabId}
          isOpen={true}
          onToggle={vi.fn()}
          onClose={vi.fn()}
        />
      );
    });

    expect(container.textContent).toContain("No MD files in VFS yet");
  });

  it("opens file in FileTab with vfsTabId and closes menu when file is clicked", async () => {
    const tabId = "canvas-test-open";
    const vfs = VfsRegistry.getOrCreate(tabId);
    vi.spyOn(vfs, "snapshot").mockResolvedValue({
      contents: {
        "/workspace/architecture.md": "# Architecture",
      },
      tracker: {},
    });
    vi.spyOn(vfs, "getAllNodeFiles").mockResolvedValue([]);

    const onClose = vi.fn();
    const openTabSpy = vi.spyOn(useWorkspaceStore.getState(), "openTab");

    await act(async () => {
      root.render(
        <VfsMarkdownMenu
          tabId={tabId}
          isOpen={true}
          onToggle={vi.fn()}
          onClose={onClose}
        />
      );
    });

    expect(container.textContent).toContain("architecture.md");

    const fileRow = container.querySelector("[title='Click to open in FileTab']") as HTMLElement;
    expect(fileRow).not.toBeNull();

    await act(async () => {
      fileRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(openTabSpy).toHaveBeenCalledWith({
      type: "file",
      path: "/workspace/architecture.md",
      title: "architecture.md (VFS)",
      vfsTabId: tabId,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("copies filename to clipboard when copy icon is clicked", async () => {
    const tabId = "canvas-test-copy";
    const vfs = VfsRegistry.getOrCreate(tabId);
    vi.spyOn(vfs, "snapshot").mockResolvedValue({
      contents: {
        "/workspace/spec.md": "# Spec",
      },
      tracker: {},
    });
    vi.spyOn(vfs, "getAllNodeFiles").mockResolvedValue([]);

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    await act(async () => {
      root.render(
        <VfsMarkdownMenu
          tabId={tabId}
          isOpen={true}
          onToggle={vi.fn()}
          onClose={vi.fn()}
        />
      );
    });

    const copyBtn = container.querySelector("[title='Copy file name for prompt']") as HTMLElement;
    expect(copyBtn).not.toBeNull();

    await act(async () => {
      copyBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(writeTextMock).toHaveBeenCalledWith("spec.md");
  });
});
