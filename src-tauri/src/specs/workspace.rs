//! Specs of the whole workspace, kept in its `.rusty` folder rather than in one repository, and the
//! optional Git repository of the workspace folder that keeps them (with the skills and the
//! workflows) under version control.
//!
//! The workspace's specs use the same layout as a repository's, rooted at `.rusty/specs` through
//! the `.rusty/specs.json` setting, so every specs command works on the workspace folder unchanged.
//! The workspace repository tracks only what is shared: the repositories inside the workspace,
//! chats, runs, metrics and traces stay out of it.
use std::{path::Path, process::Command};

use harness_specs::{layout::CONFIG_PATH, FsStore, SpecStore};
use serde::Serialize;

use super::commands::{blocking, folder, spec_error};
use crate::repository::error::RepositoryError;

/// Where the workspace's specs live, relative to the workspace folder.
pub const WORKSPACE_SPECS_ROOT: &str = ".rusty/specs";

/// What the workspace repository keeps; everything else in the folder is ignored.
const SHARED: [&str; 6] = [
    ".rusty/specs/",
    ".rusty/specs.json",
    ".rusty/skills/",
    ".rusty/workflows/",
    ".rusty/profiles/",
    ".rusty/canvas/",
];
/// The first line of the block written into `.gitignore`, so it is written once.
const IGNORE_MARKER: &str = "# Rusty workspace repository";

/// Points the workspace's specs at `.rusty/specs`, unless the workspace already says where they
/// are. Returns the specs root in use.
#[tauri::command]
pub async fn specs_workspace_prepare(workspace: String) -> Result<String, RepositoryError> {
    blocking(move || prepare(&folder(&workspace)?)).await
}

fn prepare(workspace: &Path) -> Result<String, RepositoryError> {
    let store = FsStore::new(workspace);
    if store.read(CONFIG_PATH).is_none() {
        let config = format!("{{\n  \"root\": \"{WORKSPACE_SPECS_ROOT}\"\n}}\n");
        store.write(CONFIG_PATH, &config).map_err(spec_error)?;
    }
    Ok(harness_specs::layout::resolve_root(&store))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRepository {
    /// Whether the workspace folder is (now) inside a Git repository.
    pub exists: bool,
    /// Whether the shared files were committed; `reason` says why not.
    pub committed: bool,
    pub reason: Option<String>,
}

/// Whether the workspace folder is inside a Git repository of its own.
#[tauri::command]
pub async fn workspace_repository_status(
    workspace: String,
) -> Result<WorkspaceRepository, RepositoryError> {
    blocking(move || {
        Ok(WorkspaceRepository {
            exists: is_repository(&folder(&workspace)?),
            committed: false,
            reason: None,
        })
    })
    .await
}

/// Makes the workspace folder a Git repository that keeps the workspace's specs, skills and
/// workflows, and commits them. An existing repository is left as it is.
#[tauri::command]
pub async fn workspace_repository_create(
    workspace: String,
) -> Result<WorkspaceRepository, RepositoryError> {
    blocking(move || create(&folder(&workspace)?)).await
}

fn create(workspace: &Path) -> Result<WorkspaceRepository, RepositoryError> {
    if is_repository(workspace) {
        return Ok(WorkspaceRepository {
            exists: true,
            committed: false,
            reason: Some("the workspace is already a Git repository".into()),
        });
    }
    git(workspace, &["init", "-q"])?;
    write_ignore(workspace)?;
    git(workspace, &["add", "-A"])?;
    let commit = git(
        workspace,
        &["commit", "-q", "-m", "Workspace: specs, skills and workflows"],
    );
    Ok(WorkspaceRepository {
        exists: true,
        committed: commit.is_ok(),
        reason: commit.err().map(|error| error.message),
    })
}

/// Adds the block that ignores everything but the shared files, after what `.gitignore` has.
fn write_ignore(workspace: &Path) -> Result<(), RepositoryError> {
    let path = workspace.join(".gitignore");
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    if existing.contains(IGNORE_MARKER) {
        return Ok(());
    }
    let mut block = format!(
        "{IGNORE_MARKER}: only the shared specs, skills and workflows.\n\
         # The repositories in the workspace, chats, runs, metrics and traces stay out.\n\
         /*\n!/.gitignore\n!/.rusty/\n/.rusty/*\n"
    );
    for shared in SHARED {
        block.push_str(&format!("!/{shared}\n"));
    }
    let text = if existing.trim().is_empty() {
        block
    } else {
        format!("{}\n\n{block}", existing.trim_end())
    };
    std::fs::write(&path, text).map_err(|error| RepositoryError::new("io_error", error.to_string()))
}

fn is_repository(workspace: &Path) -> bool {
    git(workspace, &["rev-parse", "--is-inside-work-tree"]).is_ok()
}

fn git(root: &Path, args: &[&str]) -> Result<(), RepositoryError> {
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|error| RepositoryError::new("git_error", format!("Git could not be started: {error}")))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(RepositoryError::new(
            "git_error",
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tracked(root: &Path) -> Vec<String> {
        let output = Command::new("git")
            .args(["ls-files"])
            .current_dir(root)
            .output()
            .unwrap();
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::to_owned)
            .collect()
    }

    #[test]
    fn the_workspace_specs_live_in_the_rusty_folder_unless_it_says_otherwise() {
        let workspace = tempfile::tempdir().unwrap();
        assert_eq!(prepare(workspace.path()).unwrap(), ".rusty/specs");
        std::fs::write(
            workspace.path().join(CONFIG_PATH),
            "{\"root\": \"docs/specs\"}",
        )
        .unwrap();
        assert_eq!(prepare(workspace.path()).unwrap(), "docs/specs");
    }

    #[test]
    fn the_workspace_repository_keeps_only_the_shared_files() {
        let workspace = tempfile::tempdir().unwrap();
        let root = workspace.path();
        for file in [
            ".rusty/specs/changes/0001-a/spec.md",
            ".rusty/skills/review.json",
            ".rusty/workflows/build.json",
            ".rusty/chats/one.json",
            ".rusty/observability/trace.jsonl",
            "ide/src/main.rs",
            "notes.txt",
        ] {
            let path = root.join(file);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "x").unwrap();
        }
        std::fs::write(root.join(".gitignore"), "/tmp\n").unwrap();
        // A commit needs an author; the test sets one for this repository only.
        std::env::set_var("GIT_AUTHOR_NAME", "t");
        std::env::set_var("GIT_AUTHOR_EMAIL", "t@t");
        std::env::set_var("GIT_COMMITTER_NAME", "t");
        std::env::set_var("GIT_COMMITTER_EMAIL", "t@t");
        let created = create(root).unwrap();
        assert!(created.exists && created.committed, "{created:?}");
        let mut files = tracked(root);
        files.sort();
        assert_eq!(
            files,
            [
                ".gitignore",
                ".rusty/skills/review.json",
                ".rusty/specs/changes/0001-a/spec.md",
                ".rusty/workflows/build.json",
            ]
        );
        let ignore = std::fs::read_to_string(root.join(".gitignore")).unwrap();
        assert!(ignore.starts_with("/tmp\n"));
        // A second call leaves the repository alone.
        assert!(create(root).unwrap().reason.is_some());
    }
}
