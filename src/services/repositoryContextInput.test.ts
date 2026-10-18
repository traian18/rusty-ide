import { describe, expect, it } from "vitest";

import { relativeToRoot, repositoryContextInput } from "./repositoryContextInput";

const tabs = [
  { id: "agent", type: "agent" },
  { id: "f1", type: "file", path: "/ws/src/a.ts" },
  { id: "f2", type: "file", path: "/elsewhere/b.ts" },
];

describe("repositoryContextInput", () => {
  it("anchors on the file open in the editor, relative to the workspace", () => {
    expect(repositoryContextInput({ tabs, activeTabId: "f1" }, "/ws/", "refactor", () => true)).toEqual({ enabled: true, activeFile: "src/a.ts", task: "refactor" });
  });

  it("names no file when the active tab is not one inside the workspace", () => {
    expect(repositoryContextInput({ tabs, activeTabId: "agent" }, "/ws", undefined, () => true)).toEqual({ enabled: true });
    expect(repositoryContextInput({ tabs, activeTabId: "f2" }, "/ws", undefined, () => true)).toEqual({ enabled: true });
  });

  it("is off without a workspace or when switched off", () => {
    expect(repositoryContextInput({ tabs, activeTabId: "f1" }, null, undefined, () => true)).toEqual({ enabled: false });
    expect(repositoryContextInput({ tabs, activeTabId: "f1" }, "/ws", undefined, () => false)).toEqual({ enabled: false });
  });

  it("names the repository chosen in the IDE", () => {
    const state = { tabs, activeTabId: "agent", repositories: [{ id: "a", worktreePath: "/ws/api" }, { id: "w", worktreePath: "/ws/web" }], activeRepositoryId: "w" };
    expect(repositoryContextInput(state, "/ws", undefined, () => true)).toEqual({ enabled: true, activeRepository: "/ws/web" });
    expect(repositoryContextInput({ ...state, activeRepositoryId: "gone" }, "/ws", undefined, () => true)).toEqual({ enabled: true });
  });

  it("resolves paths", () => {
    expect(relativeToRoot("/ws/a/b.ts", "/ws")).toBe("a/b.ts");
    expect(relativeToRoot("/wsx/a.ts", "/ws")).toBeNull();
  });
});
