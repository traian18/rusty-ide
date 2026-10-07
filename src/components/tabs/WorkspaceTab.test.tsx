// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceTab } from "./WorkspaceTab";

const { useWorkspaceStore } = vi.hoisted(() => ({
  useWorkspaceStore: vi.fn((selector: (state: { rootPath: string | null; setRootPath: () => void; setFileTree: () => void }) => unknown) =>
    selector({ rootPath: "/workspace", setRootPath: vi.fn(), setFileTree: vi.fn() }),
  ),
}));

vi.mock("../../store", () => ({ useWorkspaceStore }));
vi.mock("../../notificationStore", () => ({ notify: vi.fn() }));

describe("WorkspaceTab", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("does not render the New Canvas entry for an open workspace", () => {
    act(() => root.render(<WorkspaceTab />));

    expect(container.textContent).not.toContain("New Canvas");
    expect(container.textContent).toContain("Open Workspace");
    expect(container.textContent).toContain("Recent Workspaces");
  });
});
