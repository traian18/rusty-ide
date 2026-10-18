import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));
vi.mock("../../background/documentationRunner", () => ({ runDocumentationUpdate: vi.fn(async () => undefined) }));
vi.mock("../../store", () => ({ useWorkspaceStore: { getState: () => ({ rootPath: null }), subscribe: () => () => undefined } }));

import { indexTarget, RepositoryIndexer } from "./repositoryIndexingCoordinator";

const client = (snapshot: unknown = null) => ({
  open: vi.fn(async () => ({ snapshot }) as never),
  refresh: vi.fn(async () => ({}) as never),
  cancel: vi.fn(async () => undefined),
});
const settle = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

describe("RepositoryIndexer", () => {
  it("opens the chosen repository on the host, then resumes agreed documentation work", async () => {
    const opener = client();
    const background = { setBackground: vi.fn(async () => undefined) };
    const resume = vi.fn(async () => undefined);
    const indexer = new RepositoryIndexer(opener, background, resume, () => true);
    indexer.workspaceChanged("/ws");
    await settle();
    expect(opener.open).toHaveBeenCalledWith("/ws");
    expect(background.setBackground).toHaveBeenCalledWith(true);
    expect(resume).toHaveBeenCalledWith("/ws");
    expect(opener.refresh).not.toHaveBeenCalled();
  });

  it("tells the host when background work is switched off, and does nothing without a repository", async () => {
    const opener = client();
    const background = { setBackground: vi.fn(async () => undefined) };
    const indexer = new RepositoryIndexer(opener, background, vi.fn(async () => undefined), () => false);
    indexer.workspaceChanged(null);
    await settle();
    expect(background.setBackground).toHaveBeenCalledWith(false);
    expect(opener.open).not.toHaveBeenCalled();
  });

  it("keeps the repository chosen in the IDE indexed, not the whole workspace folder", () => {
    const repositories = [{ id: "a", worktreePath: "/ws/api" }, { id: "w", worktreePath: "/ws/web" }];
    expect(indexTarget({ rootPath: "/ws", repositories, activeRepositoryId: "w" })).toBe("/ws/web");
    expect(indexTarget({ rootPath: "/ws", repositories, activeRepositoryId: null })).toBe("/ws");
    expect(indexTarget({ rootPath: "/ws", repositories: [], activeRepositoryId: null })).toBe("/ws");
    expect(indexTarget({ rootPath: null, repositories: [], activeRepositoryId: null })).toBeNull();
  });
});
