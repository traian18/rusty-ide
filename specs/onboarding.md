# Onboarding: capabilities of rusty-ide

Edit this list, then write the capability specs. Delete an entry to skip it; copy an entry to add one.

## agent-chat-and-workflows
Purpose: Let developers converse with coding agents and run structured workflows that can plan and execute multi-step work.
Paths: `src/components/tabs/AgentTab.tsx`, `src/components/tabs/agentTab/`, `src/components/tabs/behaviors/`, `src/services/agentChatPersistence.ts`, `src-tauri/src/harness/`
Notes: Frontend chat and workflow behavior connects to native harness session construction. Saved conversations may lack newer workflow or modified-file fields; preserve compatibility when reading them.

## workspace-and-files
Purpose: Open local project folders, browse and edit their files, and manage workspace content used by other IDE features.
Paths: `src/components/tabs/WorkspaceTab.tsx`, `src/components/filetree/`, `src/components/tabs/fileTab/`, `src/services/vfs/`, `src-tauri/src/dir_listing.rs`, `src-tauri/src/lib.rs`
Notes: Workspace selection, file tabs, and the virtual file system are distinct parts of file work. General-purpose disk-file commands have a documented path-containment gap; Git’s path validation does not cover them.

## providers-and-agent-configuration
Purpose: Configure model providers, authentication, model selection, skills, and optional agent tools.
Paths: `src/components/tabs/llmSetup/`, `src/components/settings/`, `src/components/mcp/`, `src/config/`, `src/preferences/`, `src-tauri/src/harness/recipe.rs`
Notes: Provider and MCP behavior depends on external services; the survey did not verify those integrations end-to-end. Keep configuration separate from the agent workflow that consumes it.

## repository-intelligence
Purpose: Analyze local repositories and let users explore architecture, dependencies, findings, freshness, and code health.
Paths: `src/architecture/`, `src/health/`, `src-tauri/src/repository/`, `src-tauri/src/lib.rs`
Notes: Architecture exploration and code-health views share native repository services, but remain distinct from the repository documentation and specs features.

## git-and-source-control
Purpose: Inspect and manage repository state, including changes, staging, commits, branches, history, and submodules.
Paths: `src/components/git/`, `src/components/sourceControl/`, `src/store/slices/createGitSlice.ts`, `src-tauri/src/git.rs`, `src-tauri/src/git/`
Notes: Git operations validate paths to keep file actions within the repository worktree. Do not assume that protection applies to general filesystem commands.

## terminal-and-shell
Purpose: Give users an interactive terminal and let IDE and agent features execute shell commands.
Paths: `src/components/LocalTerminal.tsx`, `src/components/TerminalPanel.tsx`, `src/store/slices/createTerminalSlice.ts`, `src-tauri/src/shell_exec.rs`, `src-tauri/src/lib.rs`
Notes: Interactive PTY sessions and one-shot command execution are separate paths, with different callers and permission handling. The agent command-permission flow was not traced end-to-end.

## specs-and-repository-docs
Purpose: Create and manage project specs and changes, and inspect repository documentation and project information.
Paths: `src/specs/client.ts`, `src/wiki/`, `src/dashboard/`, `src-tauri/src/specs/`, `src-tauri/src/repository/`
Notes: These are product capabilities for projects opened in the IDE; the surveyed `rusty-ide` repository does not itself have a `specs/` directory.

## application-shell-and-operations
Purpose: Provide the desktop application frame and support startup, preferences, notifications, updates, usage tracking, and observability.
Paths: `src/App.tsx`, `src/components/shell/`, `src/preferences/`, `src/startup/`, `src/observability/`, `src-tauri/src/lib.rs`
Notes: The application shell coordinates startup and global UI, while native services provide operating-system integrations and local persistence. Workspace, Git, terminal, file, and repository-analysis paths should remain usable independently of agent activity.
