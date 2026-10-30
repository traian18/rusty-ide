export { createGitSlice } from "./state";
export { getGitState } from "./fileTreeGitState";
export { computeLineChanges, toGutterDecorations } from "./fileTabGitChanges";
export { repositoryOptions, type RepositoryOption } from "./repositoryOptions";
export { resolveRepositoryForPath } from "./resolveRepositoryForPath";
export { gitClient, type GitClient } from "./client";
export type { CommitInfo, CommitFile, Branches, BlameLine, CheckoutOutcome, PendingOperation } from "./model";
