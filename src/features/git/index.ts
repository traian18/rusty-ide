export { createGitSlice } from "./state";
export { getGitState } from "./fileTreeGitState";
export { computeLineChanges, toGutterDecorations } from "./fileTabGitChanges";
export { repositoryOptions, type RepositoryOption } from "./repositoryOptions";
export { resolveRepositoryForPath } from "./resolveRepositoryForPath";
export { gitClient, type GitClient } from "./client";
export { repositoryIndicator, type RepositoryIndicatorState } from "./repositoryIndicator";
export type { CommitInfo, CommitFile, Branches, BlameLine, CheckoutOutcome, GitStatusResult, PendingOperation } from "./model";
