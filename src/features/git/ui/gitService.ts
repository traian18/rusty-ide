/** The git service wired to the workspace: the store, the file tree, notifications and the background documentation job. */
import { useWorkspaceStore } from "../../../store";
import { notify } from "../../notifications";
import { offerDocumentationUpdate } from "../../background";
import { gitClient } from "../client";
import { explorerClient } from "../../explorer";
import { createGitService, type GitApp } from "../service";

const workspaceApp: GitApp = {
  loadStatus: (rootDir) => useWorkspaceStore.getState().loadGitStatus(rootDir),
  async reloadTree(rootDir) {
    // The tree is always rooted at the workspace, even when a child repository is the one that changed.
    const tree = await explorerClient.tree(useWorkspaceStore.getState().rootPath || rootDir);
    useWorkspaceStore.getState().setFileTree(tree);
  },
  resetForBranchChange: () => useWorkspaceStore.getState().resetForBranchChange(),
  notify,
  offerDocumentationUpdate,
};

export const gitService = createGitService(gitClient, workspaceApp);
