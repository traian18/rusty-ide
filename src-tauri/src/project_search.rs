use fuzzy_matcher::FuzzyMatcher;
use ignore::{DirEntry, WalkState};
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

const MAX_RESULTS: usize = 150;

#[derive(Serialize, Clone, Debug)]
pub struct SearchMatch {
    path: String,
    name: String,
    line: usize,
    content: String,
    pub is_content_match: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchOptions {
    pub(crate) root_dir: String,
    pub(crate) query: String,
    pub(crate) match_case: bool,
    pub(crate) whole_word: bool,
    pub(crate) is_regex: bool,
}

struct ScoredSearchMatch {
    match_val: SearchMatch,
    score: i64,
}

#[derive(Clone)]
struct SearchWorker {
    results: Arc<Mutex<Vec<ScoredSearchMatch>>>,
    root_path: Arc<PathBuf>,
    query: Arc<String>,
    query_lower: Arc<String>,
    match_case: bool,
    whole_word: bool,
    regex_matcher: Option<Arc<Regex>>,
}

pub(crate) fn search_project(options: SearchOptions) -> Result<Vec<SearchMatch>, String> {
    println!(
        "Rust [search_project] querying: '{}' (case: {}, word: {}, regex: {}) under: {}",
        options.query, options.match_case, options.whole_word, options.is_regex, options.root_dir
    );

    if options.query.trim().is_empty() {
        return Ok(Vec::new());
    }

    let root_path = PathBuf::from(&options.root_dir);
    if !root_path.exists() {
        return Err("Directory does not exist".into());
    }

    let regex_matcher = build_regex_matcher(&options)?;
    let scored_results = search_files(&root_path, options, regex_matcher)?;
    Ok(sort_and_limit_results(scored_results))
}

fn build_regex_matcher(options: &SearchOptions) -> Result<Option<Arc<Regex>>, String> {
    if !options.is_regex {
        return Ok(None);
    }

    RegexBuilder::new(&options.query)
        .case_insensitive(!options.match_case)
        .build()
        .map_err(|error| format!("Invalid regex: {}", error))
        .map(Arc::new)
        .map(Some)
}

/// Folder levels below the workspace searched for repositories at most.
const MAX_REPOSITORY_DEPTH: usize = 8;

/// The repositories inside a workspace folder at any depth: directly in it,
/// grouped in plain folders (`services/api`) or inside other repositories.
/// Each is searched from its own root, so the workspace repository's ignore
/// rules (which may leave every repository in it out) do not hide its files;
/// its own do. Hidden, dependency and build folders are not looked into, and
/// symlinks are not followed.
fn nested_repositories(root_path: &Path) -> Vec<PathBuf> {
    let mut repositories = Vec::new();
    let mut folders = vec![(root_path.to_path_buf(), 0usize)];
    while let Some((folder, depth)) = folders.pop() {
        if depth >= MAX_REPOSITORY_DEPTH {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&folder) else {
            continue;
        };
        for entry in entries.filter_map(Result::ok) {
            let is_dir = entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
            let searched = entry
                .file_name()
                .to_str()
                .is_some_and(|name| !name.starts_with('.') && !is_excluded_directory_name(name));
            if !is_dir || !searched {
                continue;
            }
            let path = entry.path();
            if path.join(".git").exists() {
                repositories.push(path.clone());
            }
            folders.push((path, depth + 1));
        }
    }
    repositories.sort();
    repositories
}

fn search_files(
    root_path: &Path,
    options: SearchOptions,
    regex_matcher: Option<Arc<Regex>>,
) -> Result<Vec<ScoredSearchMatch>, String> {
    let results = Arc::new(Mutex::new(Vec::new()));
    let root_path = Arc::new(root_path.to_path_buf());
    let query = Arc::new(options.query);
    let query_lower = Arc::new(query.to_lowercase());
    let repositories = Arc::new(nested_repositories(&root_path));
    let mut builder = ignore::WalkBuilder::new(&*root_path);
    for repository in repositories.iter() {
        builder.add(repository);
    }
    // A nested repository is walked from its own root (added above); reached
    // again from the workspace folder or a repository around it, it is skipped,
    // or its files would count twice.
    let skipped = repositories.clone();
    let walker = builder
        .hidden(true)
        .filter_entry(move |entry| {
            entry.depth() == 0 || !skipped.iter().any(|repository| repository == entry.path())
        })
        .build_parallel();

    walker.run(|| {
        let worker = SearchWorker {
            results: results.clone(),
            root_path: root_path.clone(),
            query: query.clone(),
            query_lower: query_lower.clone(),
            match_case: options.match_case,
            whole_word: options.whole_word,
            regex_matcher: regex_matcher.clone(),
        };

        Box::new(move |entry_result| worker.process_entry(entry_result))
    });

    Arc::try_unwrap(results)
        .map_err(|_| "Failed to resolve search results threads".to_string())?
        .into_inner()
        .map_err(|error| error.to_string())
}

impl SearchWorker {
    fn process_entry(&self, entry_result: Result<DirEntry, ignore::Error>) -> WalkState {
        let entry = match entry_result {
            Ok(entry) => entry,
            Err(_) => return WalkState::Continue,
        };

        if should_skip_directory(&entry) {
            return WalkState::Skip;
        }
        if !is_searchable_file(&entry) {
            return WalkState::Continue;
        }

        self.search_file(entry.path());
        WalkState::Continue
    }

    fn search_file(&self, path: &Path) {
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("")
            .to_string();
        let relative_path = path
            .strip_prefix(&*self.root_path)
            .unwrap_or(path)
            .to_string_lossy()
            .into_owned();

        self.record_filename_match(path, &name, &relative_path);
        self.record_content_matches(path, &name);
    }

    fn record_filename_match(&self, path: &Path, name: &str, relative_path: &str) {
        let matcher = fuzzy_matcher::skim::SkimMatcherV2::default();
        let score = matcher.fuzzy_match(relative_path, &self.query).unwrap_or(0);
        if score <= 0 {
            return;
        }

        self.results.lock().unwrap().push(ScoredSearchMatch {
            match_val: SearchMatch {
                path: path.to_string_lossy().into_owned(),
                name: name.to_string(),
                line: 0,
                content: String::new(),
                is_content_match: false,
            },
            score,
        });
    }

    fn record_content_matches(&self, path: &Path, name: &str) {
        let Some(content) = read_and_check_text_file(path) else {
            return;
        };

        for (line_index, raw_line) in content.lines().enumerate() {
            if !self.line_matches(raw_line) {
                continue;
            }

            self.results.lock().unwrap().push(ScoredSearchMatch {
                match_val: SearchMatch {
                    path: path.to_string_lossy().into_owned(),
                    name: name.to_string(),
                    line: line_index + 1,
                    content: raw_line.trim().to_string(),
                    is_content_match: true,
                },
                score: 0,
            });
        }
    }

    fn line_matches(&self, line: &str) -> bool {
        if let Some(regex) = &self.regex_matcher {
            return regex.is_match(line);
        }

        if self.whole_word {
            return contains_whole_word(line, &self.query, &self.query_lower, self.match_case);
        }

        contains_query(line, &self.query, &self.query_lower, self.match_case)
    }
}

fn should_skip_directory(entry: &DirEntry) -> bool {
    let is_directory = entry
        .file_type()
        .map(|file_type| file_type.is_dir())
        .unwrap_or(false);
    let is_excluded = entry
        .path()
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(is_excluded_directory_name);
    is_directory && is_excluded
}

fn is_excluded_directory_name(name: &str) -> bool {
    matches!(
        name,
        "node_modules" | ".git" | "target" | "dist" | ".vscode" | ".gemini"
    )
}

fn is_searchable_file(entry: &DirEntry) -> bool {
    entry
        .file_type()
        .map(|file_type| file_type.is_file())
        .unwrap_or(false)
}

fn read_and_check_text_file(path: &Path) -> Option<String> {
    const MAX_TEXT_FILE_BYTES: u64 = 2 * 1024 * 1024;

    let metadata = std::fs::metadata(path).ok()?;
    if metadata.len() > MAX_TEXT_FILE_BYTES {
        return None;
    }

    let bytes = std::fs::read(path).ok()?;
    if bytes[..bytes.len().min(1024)].contains(&0) {
        return None;
    }

    String::from_utf8(bytes).ok()
}

fn contains_whole_word(line: &str, query: &str, query_lower: &str, match_case: bool) -> bool {
    line.split(|character: char| !character.is_alphanumeric() && character != '_')
        .any(|word| {
            if match_case {
                word == query
            } else {
                word.to_lowercase() == query_lower
            }
        })
}

fn contains_query(line: &str, query: &str, query_lower: &str, match_case: bool) -> bool {
    if match_case {
        line.contains(query)
    } else {
        line.to_lowercase().contains(query_lower)
    }
}

fn sort_and_limit_results(mut results: Vec<ScoredSearchMatch>) -> Vec<SearchMatch> {
    results.sort_by(compare_matches);
    results
        .into_iter()
        .take(MAX_RESULTS)
        .map(|result| result.match_val)
        .collect()
}

fn compare_matches(a: &ScoredSearchMatch, b: &ScoredSearchMatch) -> Ordering {
    match (a.match_val.is_content_match, b.match_val.is_content_match) {
        (false, false) => b.score.cmp(&a.score),
        (false, true) => Ordering::Less,
        (true, false) => Ordering::Greater,
        (true, true) => a
            .match_val
            .path
            .cmp(&b.match_val.path)
            .then_with(|| a.match_val.line.cmp(&b.match_val.line)),
    }
}

#[cfg(test)]
mod tests {
    use super::{search_project, SearchOptions};

    fn search_options(root_dir: &std::path::Path, query: &str) -> SearchOptions {
        SearchOptions {
            root_dir: root_dir.to_string_lossy().into_owned(),
            query: query.to_string(),
            match_case: false,
            whole_word: false,
            is_regex: false,
        }
    }

    #[test]
    fn deserializes_the_frontend_search_options_shape() {
        let options: SearchOptions = serde_json::from_value(serde_json::json!({
            "rootDir": "/workspace",
            "query": "needle",
            "matchCase": true,
            "wholeWord": false,
            "isRegex": true
        }))
        .unwrap();

        assert_eq!(options.root_dir, "/workspace");
        assert_eq!(options.query, "needle");
        assert!(options.match_case);
        assert!(!options.whole_word);
        assert!(options.is_regex);
    }

    #[test]
    fn applies_case_and_whole_word_matching_and_orders_filename_matches_first() {
        let directory = tempfile::tempdir().unwrap();
        let file_path = directory.path().join("rusty_source.txt");
        std::fs::write(&file_path, "Rusty\nrusty\nrustyish\n").unwrap();
        let mut options = search_options(directory.path(), "rusty");
        options.whole_word = true;

        let results = search_project(options).unwrap();

        assert_eq!(results.len(), 3);
        assert!(!results[0].is_content_match);
        assert_eq!(results[0].line, 0);
        assert!(results[1].is_content_match);
        assert_eq!(results[1].line, 1);
        assert_eq!(results[2].line, 2);
    }

    #[test]
    fn skips_dependency_directories_and_supports_case_insensitive_regex() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(directory.path().join("node_modules")).unwrap();
        std::fs::write(directory.path().join("node_modules/ignored.txt"), "needle").unwrap();
        std::fs::write(
            directory.path().join("visible.txt"),
            "needles\nNeedle\nneedle",
        )
        .unwrap();
        let mut options = search_options(directory.path(), "^needle$");
        options.is_regex = true;

        let results = search_project(options).unwrap();

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].content, "Needle");
        assert_eq!(results[1].content, "needle");
        assert!(results
            .iter()
            .all(|result| result.path.ends_with("visible.txt")));
    }

    #[test]
    fn respects_case_sensitive_regex_and_rejects_invalid_patterns() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("regex.txt"), "Needle\nneedle\n").unwrap();
        let mut options = search_options(directory.path(), "^needle$");
        options.is_regex = true;
        options.match_case = true;

        let results = search_project(options).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].content, "needle");

        let mut invalid_options = search_options(directory.path(), "[");
        invalid_options.is_regex = true;
        assert!(search_project(invalid_options)
            .unwrap_err()
            .starts_with("Invalid regex:"));
    }

    #[test]
    fn searches_each_repository_of_a_workspace_whose_own_repository_ignores_them() {
        // The Rusty workspace repository keeps only its own files: `/*` leaves the
        // repositories in it out. Their code is still what a search is for.
        let workspace = tempfile::tempdir().unwrap();
        let root = workspace.path();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::write(root.join(".gitignore"), "/*\n!/.gitignore\n!/notes.md\n").unwrap();
        std::fs::write(root.join("notes.md"), "needle in the workspace").unwrap();
        let repository = root.join("core");
        std::fs::create_dir_all(repository.join(".git")).unwrap();
        std::fs::create_dir_all(repository.join("src")).unwrap();
        std::fs::create_dir_all(repository.join("generated")).unwrap();
        std::fs::write(repository.join(".gitignore"), "/generated\n").unwrap();
        std::fs::write(repository.join("src/lib.rs"), "pub enum Needle {}\n").unwrap();
        std::fs::write(repository.join("generated/out.rs"), "needle\n").unwrap();

        let results = search_project(search_options(root, "needle")).unwrap();
        let found: Vec<String> = results
            .iter()
            .filter(|result| result.is_content_match)
            .map(|result| {
                std::path::Path::new(&result.path)
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();

        // Once each: the repository is not also reached through the workspace folder,
        // and its own ignore rules still apply.
        assert_eq!(
            found,
            vec!["core/src/lib.rs".to_string(), "notes.md".to_string()]
        );
    }

    #[test]
    fn searches_repositories_grouped_in_folders_and_inside_repositories_once_each() {
        let workspace = tempfile::tempdir().unwrap();
        let root = workspace.path();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::write(root.join(".gitignore"), "/*\n!/.gitignore\n").unwrap();
        let grouped = root.join("services/payments/api");
        std::fs::create_dir_all(grouped.join(".git")).unwrap();
        std::fs::write(grouped.join("main.rs"), "needle\n").unwrap();
        let inner = root.join("core/plugins/extra");
        std::fs::create_dir_all(root.join("core/.git")).unwrap();
        std::fs::write(root.join("core/lib.rs"), "needle\n").unwrap();
        std::fs::create_dir_all(inner.join(".git")).unwrap();
        std::fs::write(inner.join("x.rs"), "needle\n").unwrap();

        let mut found: Vec<String> = search_project(search_options(root, "needle"))
            .unwrap()
            .iter()
            .filter(|result| result.is_content_match)
            .map(|result| {
                std::path::Path::new(&result.path)
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        found.sort();
        assert_eq!(
            found,
            [
                "core/lib.rs",
                "core/plugins/extra/x.rs",
                "services/payments/api/main.rs"
            ]
        );
    }

    #[test]
    fn limits_results_to_one_hundred_fifty_matches() {
        let directory = tempfile::tempdir().unwrap();
        let file_path = directory.path().join("matches.txt");
        std::fs::write(&file_path, "needle\n".repeat(160)).unwrap();

        let results = search_project(search_options(directory.path(), "needle")).unwrap();

        assert_eq!(results.len(), 150);
        assert_eq!(results[0].line, 1);
        assert_eq!(results[149].line, 150);
    }
}
