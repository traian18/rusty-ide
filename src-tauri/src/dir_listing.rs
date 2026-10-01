//! Bounded directory listing for the model-facing `list_files` and
//! `project_info` tools.
//!
//! `get_directory_structure` (lib.rs) walks a whole tree with no depth limit
//! and only skips a handful of directory names, so pointing it at a Python
//! project's `.venv` or a Gradle `build/` reads every file in them. This
//! lists to a requested depth, skips dependency/cache/output directories, and
//! stops after `MAX_ENTRIES`, so the cost of one call is bounded however big
//! the workspace is. Directories below the depth limit are reported with a
//! count of what they hold instead of being walked.

use std::path::Path;

use serde::Serialize;

/// Directories never worth listing: dependencies, VCS data, build output and
/// caches. Includes every name the TypeScript side's `IGNORED_DIRS`
/// (exploreTools.ts) drops, so both views of a workspace agree.
const IGNORED_DIRS: &[&str] = &[
    "node_modules",
    "dist",
    ".git",
    "target",
    ".vscode",
    ".gemini",
    ".next",
    "__pycache__",
    ".env",
    "env",
    ".venv",
    "venv",
    ".turbo",
    ".cache",
    ".mypy_cache",
    ".pytest_cache",
    ".gradle",
    ".idea",
    "coverage",
];

/// Entries returned by one call, across all levels.
pub const MAX_ENTRIES: usize = 5000;
/// Deepest level one call will list.
pub const MAX_DEPTH: usize = 8;

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct DirEntryInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    /// The directory's contents, when they were listed.
    pub children: Option<Vec<DirEntryInfo>>,
    /// How many entries a directory holds, when its contents were not listed
    /// because the depth limit was reached.
    pub entries: Option<usize>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct DirListing {
    pub entries: Vec<DirEntryInfo>,
    /// The listing hit `MAX_ENTRIES` and omits the rest.
    pub truncated: bool,
}

fn is_ignored_dir(name: &str) -> bool {
    IGNORED_DIRS.contains(&name)
}

/// Directories first, then names, case-insensitively.
fn order(a: &DirEntryInfo, b: &DirEntryInfo) -> std::cmp::Ordering {
    b.is_dir
        .cmp(&a.is_dir)
        .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
}

fn count_entries(path: &Path) -> Option<usize> {
    let read = std::fs::read_dir(path).ok()?;
    Some(
        read.filter_map(Result::ok)
            .filter(|entry| {
                let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
                !(is_dir && is_ignored_dir(&entry.file_name().to_string_lossy()))
            })
            .count(),
    )
}

fn list_level(
    path: &Path,
    depth: usize,
    budget: &mut usize,
    truncated: &mut bool,
) -> Vec<DirEntryInfo> {
    let Ok(read) = std::fs::read_dir(path) else {
        // An unreadable subdirectory is shown empty rather than failing the listing.
        return Vec::new();
    };
    let mut found = Vec::new();
    for entry in read.filter_map(Result::ok) {
        let name = entry.file_name().to_string_lossy().into_owned();
        // `file_type` does not follow symlinks, so a link to a directory is
        // listed as a file and can never send the walk in circles.
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir && is_ignored_dir(&name) {
            continue;
        }
        found.push((entry, name, is_dir));
    }
    // Sort before spending the budget so a truncated listing keeps the same
    // entries (directories, then early names) on every call.
    found.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| a.1.to_lowercase().cmp(&b.1.to_lowercase())));

    let mut entries = Vec::new();
    for (entry, name, is_dir) in found {
        if *budget == 0 {
            *truncated = true;
            break;
        }
        *budget -= 1;
        let entry_path = entry.path();
        let (children, held) = if !is_dir {
            (None, None)
        } else if depth > 1 {
            (
                Some(list_level(&entry_path, depth - 1, budget, truncated)),
                None,
            )
        } else {
            (None, count_entries(&entry_path))
        };
        entries.push(DirEntryInfo {
            name,
            path: entry_path.to_string_lossy().into_owned(),
            is_dir,
            children,
            entries: held,
        });
    }
    entries.sort_by(order);
    entries
}

/// Lists `path` down `depth` levels (1 = its immediate entries).
pub fn list_directory_sync(path: &Path, depth: usize, max_entries: usize) -> Result<DirListing, String> {
    let meta = std::fs::metadata(path).map_err(|_| "Directory does not exist".to_string())?;
    if !meta.is_dir() {
        return Err("Not a directory".to_string());
    }
    let mut budget = max_entries;
    let mut truncated = false;
    let entries = list_level(path, depth.clamp(1, MAX_DEPTH), &mut budget, &mut truncated);
    Ok(DirListing { entries, truncated })
}

#[tauri::command]
pub async fn list_directory(path: String, depth: Option<usize>) -> Result<DirListing, String> {
    list_directory_sync(&crate::resolve_path(&path), depth.unwrap_or(1), MAX_ENTRIES)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    /// A throwaway directory removed on drop.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new(label: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let dir = std::env::temp_dir().join(format!(
                "rusty-listing-{label}-{}-{nanos}",
                std::process::id()
            ));
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn file(&self, relative: &str) {
            let path = self.0.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, "x").unwrap();
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn names(entries: &[DirEntryInfo]) -> Vec<&str> {
        entries.iter().map(|e| e.name.as_str()).collect()
    }

    #[test]
    fn lists_one_level_with_directories_first_and_skips_noise() {
        let dir = Scratch::new("one");
        dir.file("src/main.rs");
        dir.file("README.md");
        dir.file("Cargo.toml");
        dir.file("node_modules/dep/index.js");
        dir.file("target/debug/app");
        dir.file(".git/HEAD");
        dir.file(".venv/bin/python");

        let listing = list_directory_sync(&dir.0, 1, MAX_ENTRIES).unwrap();
        assert_eq!(names(&listing.entries), ["src", "Cargo.toml", "README.md"]);
        assert!(!listing.truncated);
        let src = &listing.entries[0];
        assert!(src.is_dir);
        assert_eq!(src.children, None, "depth 1 does not open src");
        assert_eq!(src.entries, Some(1), "but says what it holds");
    }

    #[test]
    fn nests_to_the_requested_depth_only() {
        let dir = Scratch::new("depth");
        dir.file("a/b/c/deep.txt");
        dir.file("a/top.txt");

        let two = list_directory_sync(&dir.0, 2, MAX_ENTRIES).unwrap();
        let a = &two.entries[0];
        let inside = a.children.as_ref().unwrap();
        assert_eq!(names(inside), ["b", "top.txt"]);
        assert_eq!(inside[0].children, None, "b is past the depth limit");
        assert_eq!(inside[0].entries, Some(1));

        let three = list_directory_sync(&dir.0, 3, MAX_ENTRIES).unwrap();
        let c = &three.entries[0].children.as_ref().unwrap()[0];
        assert_eq!(names(c.children.as_ref().unwrap()), ["c"]);
    }

    #[test]
    fn stops_at_the_entry_budget_and_says_so() {
        let dir = Scratch::new("budget");
        for index in 0..10 {
            dir.file(&format!("f{index:02}.txt"));
        }
        let listing = list_directory_sync(&dir.0, 1, 4).unwrap();
        assert_eq!(listing.entries.len(), 4);
        assert!(listing.truncated);
        assert_eq!(
            names(&listing.entries),
            ["f00.txt", "f01.txt", "f02.txt", "f03.txt"],
            "a truncated listing is the same every time"
        );
    }

    #[test]
    fn rejects_a_missing_path_and_a_file() {
        let dir = Scratch::new("errors");
        dir.file("a.txt");
        assert_eq!(
            list_directory_sync(&dir.0.join("nope"), 1, MAX_ENTRIES),
            Err("Directory does not exist".to_string())
        );
        assert_eq!(
            list_directory_sync(&dir.0.join("a.txt"), 1, MAX_ENTRIES),
            Err("Not a directory".to_string())
        );
    }

    #[test]
    fn depth_is_clamped_to_a_sane_range() {
        let dir = Scratch::new("clamp");
        dir.file("a/b.txt");
        let zero = list_directory_sync(&dir.0, 0, MAX_ENTRIES).unwrap();
        assert_eq!(zero.entries[0].children, None, "0 behaves as 1");
        assert!(list_directory_sync(&dir.0, 10_000, MAX_ENTRIES).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn does_not_follow_a_symlink_to_a_directory() {
        let dir = Scratch::new("symlink");
        dir.file("real/inner.txt");
        std::os::unix::fs::symlink(dir.0.join("real"), dir.0.join("link")).unwrap();
        let listing = list_directory_sync(&dir.0, 3, MAX_ENTRIES).unwrap();
        let link = listing.entries.iter().find(|e| e.name == "link").unwrap();
        assert!(!link.is_dir);
        assert_eq!(link.children, None);
    }
}
