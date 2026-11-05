/** The explorer service wired to the workspace: the store, notifications and the system file manager. */
import { useWorkspaceStore } from "../../../store";
import { notify } from "../../notifications";
import { revealItemInDir } from "../../../lib/platform/opener";
import { duplicateTabId, fileTabIdentity } from "../../../app/tabs/identity";
import { explorerClient } from "../client";
import { createExplorerService, type ExplorerApp } from "../service";

const workspaceApp: ExplorerApp = {
  rootPath: () => useWorkspaceStore.getState().rootPath,
  setFileTree: (tree) => useWorkspaceStore.getState().setFileTree(tree),
  loadGitStatus: () => useWorkspaceStore.getState().loadGitStatus(),
  setPathExpanded: (path, expanded) => useWorkspaceStore.getState().setPathExpanded(path, expanded),
  openFileTabs: () =>
    useWorkspaceStore
      .getState()
      .tabs.flatMap((tab) => (tab.type === "file" ? [{ id: tab.id, path: tab.path }] : [])),
  // A file's copy goes with it, so it cannot be left showing a path that moved.
  closeTab: (id) => {
    const { closeTab } = useWorkspaceStore.getState();
    closeTab(id);
    closeTab(duplicateTabId(id));
  },
  tabIdForPath: fileTabIdentity,
  setLastRename: (rename) => useWorkspaceStore.getState().setLastRename(rename),
  notify,
  revealInFolder: revealItemInDir,
};

export const explorerService = createExplorerService(explorerClient, workspaceApp);
export const { refreshTree, scheduleTreeRefresh } = explorerService;
