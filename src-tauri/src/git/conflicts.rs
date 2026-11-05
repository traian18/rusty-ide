//! What a merge, rebase, cherry-pick or revert left unfinished, and the
//! commands that finish it. The IDE's merge window reads each conflicted
//! file's three versions from the index stages and lines them up with git's
//! own diff, so what it shows is what git merged, never a second opinion.

use super::{
    current_branch_name, file_status, git_succeeds, relative_to_root, require_directory, run_git,
    run_git_command, validate_path_in_worktree, GitError, GitFileStatus,
};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

/// Larger versions are offered as a whole-file choice, like binary ones: the
/// three panes keep every line of all three in memory.
const MAX_TEXT_BYTES: usize = 5 * 1024 * 1024;

/// Git reads this much of a blob to decide it is binary.
const BINARY_SNIFF_BYTES: usize = 8000;

/// One side's change against the other version, as 0-based half-open line
/// ranges: `base_start..base_end` became `side_start..side_end`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct GitLineHunk {
    pub base_start: usize,
    pub base_end: usize,
    pub side_start: usize,
    pub side_end: usize,
}

/// One unmerged path. `kind` says which sides still have the file:
/// "content", "local-only", "incoming-only" or "both-deleted".
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitConflictEntry {
    pub path: String,
    pub relative_path: String,
    pub name: String,
    pub kind: String,
}

/// The operation in progress and the paths it could not merge. `operation`
/// is absent when the conflicts came from applying a stash, which has
/// nothing to continue or abort.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitConflictState {
    pub operation: Option<String>,
    pub local_label: String,
    pub incoming_label: String,
    pub files: Vec<GitConflictEntry>,
}

/// One conflicted file's versions. "Local" is always the user's work and
/// "incoming" what is being brought in, which a rebase has the other way
/// round from git's ours and theirs. `binary` covers large files too, and
/// leaves the three versions empty.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitConflictFile {
    pub path: String,
    pub relative_path: String,
    pub kind: String,
    pub binary: bool,
    pub base: Option<String>,
    pub local: Option<String>,
    pub incoming: Option<String>,
    pub working: Option<String>,
    pub local_hunks: Vec<GitLineHunk>,
    pub incoming_hunks: Vec<GitLineHunk>,
}

/// The operation a repository is in the middle of, read from the markers git
/// leaves in its directory. `--git-path` finds them in worktrees and
/// submodules too, where `.git` is not a directory.
pub(super) fn pending_operation(root_dir: &str) -> Option<&'static str> {
    const MARKERS: [(&str, &str); 5] = [
        ("rebase-merge", "rebase"),
        ("rebase-apply", "rebase"),
        ("MERGE_HEAD", "merge"),
        ("CHERRY_PICK_HEAD", "cherry-pick"),
        ("REVERT_HEAD", "revert"),
    ];
    let mut args = vec!["rev-parse"];
    for (marker, _) in MARKERS {
        args.extend(["--git-path", marker]);
    }
    let output = run_git(root_dir, "git_status", &args).ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .zip(MARKERS)
        .find(|(path, _)| Path::new(root_dir).join(path).exists())
        .map(|(_, (_, operation))| operation)
}

/// Which index stage holds the (local, incoming) version. A rebase replays
/// the user's commits onto the incoming branch, so stage 3 is their work.
fn stages_for(operation: Option<&str>) -> (u8, u8) {
    match operation {
        Some("rebase") => (3, 2),
        _ => (2, 3),
    }
}

/// The stages each unmerged path has, in `git ls-files -u` order.
fn unmerged_stages(root_dir: &str, operation: &str) -> Result<Vec<(String, Vec<u8>)>, GitError> {
    let output = run_git(root_dir, operation, &["ls-files", "--unmerged", "-z"])?;
    Ok(parse_unmerged(&String::from_utf8_lossy(&output.stdout)))
}

/// Parses `<mode> <object> <stage>\t<path>` records. Each path has one record
/// per stage, and they are adjacent.
fn parse_unmerged(raw: &str) -> Vec<(String, Vec<u8>)> {
    let mut paths: Vec<(String, Vec<u8>)> = Vec::new();
    for record in raw.split('\0').filter(|record| !record.is_empty()) {
        let Some((meta, path)) = record.split_once('\t') else {
            continue;
        };
        let Some(stage) = meta.rsplit(' ').next().and_then(|s| s.parse::<u8>().ok()) else {
            continue;
        };
        match paths.last_mut() {
            Some((last, stages)) if last == path => stages.push(stage),
            _ => paths.push((path.to_string(), vec![stage])),
        }
    }
    paths
}

fn conflict_kind(stages: &[u8], local: u8, incoming: u8) -> &'static str {
    match (stages.contains(&local), stages.contains(&incoming)) {
        (true, true) => "content",
        (true, false) => "local-only",
        (false, true) => "incoming-only",
        (false, false) => "both-deleted",
    }
}

/// A commit's name for a label: the branch it is the tip of, else its short id.
fn revision_label(root_dir: &str, revision: &str) -> String {
    let named = run_git(
        root_dir,
        "git_conflict_state",
        &["name-rev", "--name-only", "--no-undefined", revision],
    );
    if let Ok(output) = named {
        let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return name.strip_prefix("remotes/").unwrap_or(&name).to_string();
    }
    revision.chars().take(7).collect()
}

fn git_path_text(root_dir: &str, name: &str) -> Option<String> {
    let output = run_git(
        root_dir,
        "git_conflict_state",
        &["rev-parse", "--git-path", name],
    )
    .ok()?;
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let text = std::fs::read_to_string(Path::new(root_dir).join(path)).ok()?;
    Some(text.trim().to_string())
}

/// Names for the two sides, in the operation's own terms.
fn side_labels(root_dir: &str, operation: Option<&str>) -> (String, String) {
    let branch = current_branch_name(root_dir).unwrap_or_else(|_| "HEAD".to_string());
    match operation {
        Some("merge") => (branch, revision_label(root_dir, "MERGE_HEAD")),
        Some("rebase") => {
            // HEAD is detached during a rebase, on the commits replayed so far.
            let local = ["rebase-merge/head-name", "rebase-apply/head-name"]
                .iter()
                .find_map(|file| git_path_text(root_dir, file))
                .map(|name| name.trim_start_matches("refs/heads/").to_string())
                .unwrap_or(branch);
            let incoming = ["rebase-merge/onto", "rebase-apply/onto"]
                .iter()
                .find_map(|file| git_path_text(root_dir, file))
                .map(|onto| revision_label(root_dir, &onto))
                .unwrap_or_else(|| "onto".to_string());
            (local, incoming)
        }
        Some("cherry-pick") => (branch, revision_label(root_dir, "CHERRY_PICK_HEAD")),
        Some("revert") => {
            let commit = revision_label(root_dir, "REVERT_HEAD");
            (branch, format!("revert of {commit}"))
        }
        _ => (branch, "stashed changes".to_string()),
    }
}

/// The unmerged paths under `git status`'s `U`, `AA` and `DD` codes, which
/// are conflicts rather than a staged and an unstaged change.
pub(super) fn is_unmerged_code(x: char, y: char) -> bool {
    matches!((x, y), ('D', 'D') | ('A', 'A') | ('U', _) | (_, 'U'))
}

pub(super) fn conflicted_status(root_path: &Path, path: &str) -> GitFileStatus {
    file_status(root_path, path, "conflicted")
}

/// What is unfinished in the repository; `files` is empty when nothing is.
#[tauri::command]
pub async fn git_conflict_state(root_dir: String) -> Result<GitConflictState, GitError> {
    require_directory(&root_dir, "git_conflict_state")?;
    let operation = pending_operation(&root_dir);
    let (local, incoming) = stages_for(operation);
    let root_path = Path::new(&root_dir);
    let files = unmerged_stages(&root_dir, "git_conflict_state")?
        .into_iter()
        .map(|(path, stages)| {
            let status = file_status(root_path, &path, "conflicted");
            GitConflictEntry {
                path: status.path,
                relative_path: path,
                name: status.name,
                kind: conflict_kind(&stages, local, incoming).to_string(),
            }
        })
        .collect();
    let (local_label, incoming_label) = side_labels(&root_dir, operation);
    Ok(GitConflictState {
        operation: operation.map(str::to_string),
        local_label,
        incoming_label,
        files,
    })
}

/// The blob at `stage`, or `None` when that side has no such file.
fn stage_bytes(root_dir: &str, stage: u8, relative: &str) -> Option<Vec<u8>> {
    let spec = format!(":{stage}:{relative}");
    let output = run_git(root_dir, "git_conflict_file", &["show", &spec]).ok()?;
    Some(output.stdout)
}

fn looks_binary(bytes: &[u8]) -> bool {
    bytes.len() > MAX_TEXT_BYTES
        || bytes.iter().take(BINARY_SNIFF_BYTES).any(|byte| *byte == 0)
        || std::str::from_utf8(bytes).is_err()
}

/// Parses the `@@ -a,b +c,d @@` headers of a `--unified=0` diff. With a count
/// of zero, git gives the line before the gap instead of the first line.
fn parse_hunks(diff: &str) -> Vec<GitLineHunk> {
    let range = |text: &str| -> Option<(usize, usize)> {
        let (start, count) = match text.split_once(',') {
            Some((start, count)) => (start.parse().ok()?, count.parse().ok()?),
            None => (text.parse().ok()?, 1),
        };
        let from = if count == 0 { start } else { start - 1 };
        Some((from, from + count))
    };
    diff.lines()
        .filter_map(|line| {
            let mut fields = line.strip_prefix("@@ -")?.split_whitespace();
            let (base_start, base_end) = range(fields.next()?)?;
            let (side_start, side_end) = range(fields.next()?.strip_prefix('+')?)?;
            Some(GitLineHunk {
                base_start,
                base_end,
                side_start,
                side_end,
            })
        })
        .collect()
}

/// The merge machinery's own diff between two blobs: `ort` uses histogram.
fn stage_hunks(
    root_dir: &str,
    from_stage: u8,
    to_stage: u8,
    relative: &str,
) -> Result<Vec<GitLineHunk>, GitError> {
    let output = run_git(
        root_dir,
        "git_conflict_file",
        &[
            "diff",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "--diff-algorithm=histogram",
            "--unified=0",
            "--inter-hunk-context=0",
            &format!(":{from_stage}:{relative}"),
            &format!(":{to_stage}:{relative}"),
        ],
    )?;
    Ok(parse_hunks(&String::from_utf8_lossy(&output.stdout)))
}

fn as_text(bytes: Option<&Vec<u8>>) -> Option<String> {
    bytes.map(|bytes| String::from_utf8_lossy(bytes).into_owned())
}

/// The three versions of a conflicted file, what is on disk now, and how each
/// side changed the common version. With no common version (both sides added
/// the file) `incoming_hunks` compares incoming against local.
#[tauri::command]
pub async fn git_conflict_file(
    root_dir: String,
    file_path: String,
) -> Result<GitConflictFile, GitError> {
    let relative = relative_to_root(&root_dir, &file_path, "git_conflict_file")?;
    let operation = pending_operation(&root_dir);
    let (local_stage, incoming_stage) = stages_for(operation);
    let stages = unmerged_stages(&root_dir, "git_conflict_file")?
        .into_iter()
        .find(|(path, _)| *path == relative)
        .map(|(_, stages)| stages)
        .ok_or_else(|| {
            GitError::local(
                "git_conflict_file",
                &root_dir,
                format!("{relative} has no conflict"),
            )
        })?;

    let base = stage_bytes(&root_dir, 1, &relative);
    let local = stage_bytes(&root_dir, local_stage, &relative);
    let incoming = stage_bytes(&root_dir, incoming_stage, &relative);
    let binary = [&base, &local, &incoming]
        .iter()
        .any(|version| version.as_deref().is_some_and(looks_binary));

    let target = validate_path_in_worktree(&root_dir, &file_path)?;
    let working = std::fs::read(&target).ok();
    let working_is_text = working.as_deref().is_some_and(|bytes| !looks_binary(bytes));
    let kind = conflict_kind(&stages, local_stage, incoming_stage).to_string();

    let both_sides = local.is_some() && incoming.is_some() && !binary;
    let (local_hunks, incoming_hunks) = match (both_sides, base.is_some()) {
        (false, _) => (Vec::new(), Vec::new()),
        (true, true) => (
            stage_hunks(&root_dir, 1, local_stage, &relative)?,
            stage_hunks(&root_dir, 1, incoming_stage, &relative)?,
        ),
        (true, false) => (
            Vec::new(),
            stage_hunks(&root_dir, local_stage, incoming_stage, &relative)?,
        ),
    };

    Ok(GitConflictFile {
        path: file_path,
        relative_path: relative,
        kind,
        binary,
        base: if binary { None } else { as_text(base.as_ref()) },
        local: if binary {
            None
        } else {
            as_text(local.as_ref())
        },
        incoming: if binary {
            None
        } else {
            as_text(incoming.as_ref())
        },
        working: if working_is_text {
            as_text(working.as_ref())
        } else {
            None
        },
        local_hunks,
        incoming_hunks,
    })
}

/// Saves the merged text as the file and marks it resolved.
#[tauri::command]
pub async fn git_resolve_conflict(
    root_dir: String,
    file_path: String,
    content: String,
) -> Result<(), GitError> {
    const OPERATION: &str = "git_resolve_conflict";
    let relative = relative_to_root(&root_dir, &file_path, OPERATION)?;
    let target = validate_path_in_worktree(&root_dir, &file_path)?;
    let write_failed =
        |error: std::io::Error| GitError::local(OPERATION, &root_dir, error.to_string());
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(write_failed)?;
    }
    std::fs::write(&target, content).map_err(write_failed)?;
    run_git(&root_dir, OPERATION, &["add", "--", &relative])?;
    Ok(())
}

/// Resolves a file by keeping one side whole: its version, or its deletion
/// when that side no longer has the file. The only choice for a binary file.
#[tauri::command]
pub async fn git_resolve_conflict_side(
    root_dir: String,
    file_path: String,
    side: String,
) -> Result<(), GitError> {
    const OPERATION: &str = "git_resolve_conflict_side";
    let relative = relative_to_root(&root_dir, &file_path, OPERATION)?;
    let (local, incoming) = stages_for(pending_operation(&root_dir));
    let stage = match side.as_str() {
        "local" => local,
        "incoming" => incoming,
        other => {
            return Err(GitError::local(
                OPERATION,
                &root_dir,
                format!("Unknown side: {other}"),
            ))
        }
    };
    if stage_bytes(&root_dir, stage, &relative).is_none() {
        run_git(
            &root_dir,
            OPERATION,
            &["rm", "--force", "--quiet", "--", &relative],
        )?;
        return Ok(());
    }
    let flag = if stage == 2 { "--ours" } else { "--theirs" };
    run_git(&root_dir, OPERATION, &["checkout", flag, "--", &relative])?;
    run_git(&root_dir, OPERATION, &["add", "--", &relative])?;
    Ok(())
}

/// Finishes the operation in progress once its conflicts are resolved. A
/// rebase, cherry-pick or revert step that resolved to no change is skipped,
/// as `--continue` refuses it. Git never gets an editor here: the merge keeps
/// the message git prepared.
#[tauri::command]
pub async fn git_complete_pending(root_dir: String) -> Result<(), GitError> {
    const OPERATION: &str = "git_complete_pending";
    match pending_operation(&root_dir) {
        None => Err(GitError::local(
            OPERATION,
            &root_dir,
            "No merge or rebase is in progress",
        )),
        Some("merge") => {
            run_git(&root_dir, OPERATION, &["commit", "--no-edit"])?;
            Ok(())
        }
        Some(sequence) => {
            let nothing_staged = git_succeeds(&root_dir, &["diff", "--cached", "--quiet"]);
            let step = if nothing_staged {
                "--skip"
            } else {
                "--continue"
            };
            let mut command = Command::new("git");
            command.env("GIT_EDITOR", "true");
            run_git_command(command, &root_dir, OPERATION, &[sequence, step])?;
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hunks_use_half_open_zero_based_ranges() {
        let diff =
            "diff --git a b\n@@ -2,3 +2 @@ fn x\n-a\n@@ -7,0 +6,2 @@\n+b\n+c\n@@ -9 +10,0 @@\n-d\n";
        assert_eq!(
            parse_hunks(diff),
            vec![
                GitLineHunk {
                    base_start: 1,
                    base_end: 4,
                    side_start: 1,
                    side_end: 2
                },
                GitLineHunk {
                    base_start: 7,
                    base_end: 7,
                    side_start: 5,
                    side_end: 7
                },
                GitLineHunk {
                    base_start: 8,
                    base_end: 9,
                    side_start: 10,
                    side_end: 10
                },
            ]
        );
    }

    #[test]
    fn unmerged_records_group_stages_by_path() {
        let raw = "100644 aaa 1\ta.txt\x00100644 bbb 2\ta.txt\x00100644 ccc 3\ta.txt\x00100644 ddd 2\tb c.txt\0";
        assert_eq!(
            parse_unmerged(raw),
            vec![
                ("a.txt".to_string(), vec![1, 2, 3]),
                ("b c.txt".to_string(), vec![2]),
            ]
        );
    }

    #[test]
    fn a_rebase_swaps_which_stage_is_the_users_work() {
        assert_eq!(stages_for(Some("rebase")), (3, 2));
        assert_eq!(stages_for(Some("merge")), (2, 3));
        assert_eq!(conflict_kind(&[1, 3], 3, 2), "local-only");
        assert_eq!(conflict_kind(&[1, 3], 2, 3), "incoming-only");
        assert_eq!(conflict_kind(&[1], 2, 3), "both-deleted");
    }

    #[test]
    fn every_unmerged_status_code_is_recognised() {
        for (x, y) in [
            ('D', 'D'),
            ('A', 'U'),
            ('U', 'D'),
            ('U', 'A'),
            ('D', 'U'),
            ('A', 'A'),
            ('U', 'U'),
        ] {
            assert!(is_unmerged_code(x, y), "{x}{y}");
        }
        for (x, y) in [('M', 'M'), ('A', 'M'), ('D', ' '), ('A', ' '), (' ', 'D')] {
            assert!(!is_unmerged_code(x, y), "{x}{y}");
        }
    }
}
