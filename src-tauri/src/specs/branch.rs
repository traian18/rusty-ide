//! The Git branch a new change starts on, so the spec lands on it rather than on the current branch.
use std::{path::Path, process::Command};

use serde::Serialize;

/// What happened when a branch was asked for.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum BranchOutcome {
    /// The branch exists and is checked out.
    Created { name: String },
    /// No branch was made; the reason is shown next to the change.
    Skipped { reason: String },
}

/// Creates `name` from the current commit and switches to it. Uncommitted work comes along.
/// Never fails the caller: a missing repository or a name clash is a `Skipped` with the reason.
pub fn create_and_switch(root: &Path, name: &str) -> BranchOutcome {
    let git = |args: &[&str]| Command::new("git").args(args).current_dir(root).output();
    match git(&["rev-parse", "--is-inside-work-tree"]) {
        Ok(output) if output.status.success() => {}
        Ok(_) => return skipped("this folder is not a Git repository"),
        Err(error) => return skipped(format!("Git could not be started: {error}")),
    }
    if git(&["rev-parse", "--verify", "--quiet", "HEAD"]).is_ok_and(|o| !o.status.success()) {
        return skipped("the repository has no commits yet");
    }
    match git(&["switch", "-c", name]) {
        Ok(output) if output.status.success() => BranchOutcome::Created {
            name: name.to_owned(),
        },
        Ok(output) => skipped(String::from_utf8_lossy(&output.stderr).trim().to_owned()),
        Err(error) => skipped(format!("Git could not be started: {error}")),
    }
}

fn skipped(reason: impl Into<String>) -> BranchOutcome {
    BranchOutcome::Skipped {
        reason: reason.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(root: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args(["-c", "user.name=t", "-c", "user.email=t@t"])
            .args(args)
            .current_dir(root)
            .status()
            .unwrap();
        assert!(status.success(), "git {args:?}");
    }

    fn current_branch(root: &Path) -> String {
        let output = Command::new("git")
            .args(["branch", "--show-current"])
            .current_dir(root)
            .output()
            .unwrap();
        String::from_utf8_lossy(&output.stdout).trim().to_owned()
    }

    #[test]
    fn a_folder_that_is_not_a_repository_is_skipped() {
        let directory = tempfile::tempdir().unwrap();
        assert!(matches!(
            create_and_switch(directory.path(), "spec/0001-a"),
            BranchOutcome::Skipped { .. }
        ));
    }

    #[test]
    fn a_repository_without_commits_is_skipped_with_the_reason() {
        let directory = tempfile::tempdir().unwrap();
        run(directory.path(), &["init", "-q"]);
        let BranchOutcome::Skipped { reason } = create_and_switch(directory.path(), "spec/0001-a")
        else {
            panic!("expected skipped")
        };
        assert!(reason.contains("no commits"));
    }

    #[test]
    fn the_branch_is_created_checked_out_and_never_made_twice() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        run(root, &["init", "-q"]);
        std::fs::write(root.join("a.txt"), "a").unwrap();
        run(root, &["add", "."]);
        run(root, &["commit", "-q", "-m", "first"]);
        assert_eq!(
            create_and_switch(root, "spec/0001-a"),
            BranchOutcome::Created {
                name: "spec/0001-a".into()
            }
        );
        assert_eq!(current_branch(root), "spec/0001-a");
        run(root, &["switch", "-q", "-"]);
        assert!(matches!(
            create_and_switch(root, "spec/0001-a"),
            BranchOutcome::Skipped { .. }
        ));
    }
}
