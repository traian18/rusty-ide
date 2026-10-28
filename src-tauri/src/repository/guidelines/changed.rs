//! What changed in a file since the last commit, from a diff of its committed and current content.
use std::path::Path;

use harness_guidelines::ChangedLines;

fn line_count(bytes: &[u8]) -> u32 {
    if bytes.is_empty() {
        return 0;
    }
    let newlines = bytes.iter().filter(|b| **b == b'\n').count() as u32;
    newlines + u32::from(!bytes.ends_with(b"\n"))
}

fn committed(repo: &git2::Repository, relative: &Path) -> Option<Vec<u8>> {
    let tree = repo.head().ok()?.peel_to_tree().ok()?;
    let entry = tree.get_path(relative).ok()?;
    let blob = entry.to_object(repo).ok()?.peel_to_blob().ok()?;
    Some(blob.content().to_vec())
}

/// The changed lines of `path` (relative to `root`); a file the last commit does not have is new.
/// `None` when there is no Git repository or the file cannot be read: then everything counts.
pub(in crate::repository) fn changed_lines(root: &Path, path: &str) -> Option<ChangedLines> {
    let repo = git2::Repository::discover(root).ok()?;
    let full = root.join(path);
    let workdir = std::fs::canonicalize(repo.workdir()?).ok()?;
    let canonical = std::fs::canonicalize(&full).ok()?;
    let relative = canonical.strip_prefix(&workdir).ok()?;
    let now = std::fs::read(&canonical).ok()?;
    let Some(base) = committed(&repo, relative) else {
        return Some(ChangedLines::new_file());
    };
    let patch = git2::Patch::from_buffers(&base, None, &now, None, None).ok()?;
    let mut ranges: Vec<(u32, u32)> = Vec::new();
    for hunk in 0..patch.num_hunks() {
        for index in 0..patch.num_lines_in_hunk(hunk).ok()? {
            let line = patch.line_in_hunk(hunk, index).ok()?;
            let Some(number) = line.new_lineno().filter(|_| line.origin() == '+') else {
                continue;
            };
            match ranges.last_mut() {
                Some((_, end)) if *end + 1 == number => *end = number,
                _ => ranges.push((number, number)),
            }
        }
    }
    Some(ChangedLines {
        ranges,
        base_line_count: Some(line_count(&base)),
    })
}

#[cfg(test)]
mod tests {
    use super::changed_lines;

    #[test]
    fn added_and_modified_lines_are_ranges_and_a_new_file_is_all_new() {
        let dir = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(dir.path()).unwrap();
        std::fs::write(dir.path().join("a.rs"), "one\ntwo\nthree\nfour\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("a.rs")).unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let who = git2::Signature::now("t", "t@example.com").unwrap();
        repo.commit(Some("HEAD"), &who, &who, "init", &tree, &[])
            .unwrap();

        std::fs::write(
            dir.path().join("a.rs"),
            "one\nTWO\nthree\nfour\nfive\nsix\n",
        )
        .unwrap();
        let changed = changed_lines(dir.path(), "a.rs").unwrap();
        assert_eq!(changed.ranges, vec![(2, 2), (5, 6)]);
        assert_eq!(changed.base_line_count, Some(4));

        std::fs::write(dir.path().join("b.rs"), "new\n").unwrap();
        assert_eq!(
            changed_lines(dir.path(), "b.rs").unwrap().base_line_count,
            None
        );
    }
}
