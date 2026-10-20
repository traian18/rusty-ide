//! Which files have tests, from what is known without running anything: test files that import
//! them (directly or through one other file), a test named after them, tests inside them.
use std::{collections::HashSet, path::Path};

use harness_code_analysis::metrics::FileMetrics;
use harness_code_health::TestLinks;
use harness_repository_wiki::{facts::Facts, tests_of::is_test_file};
use harness_workspace::repository_intelligence::RootRelativePath;

/// The name a file is about: lower case, extension and test markers removed
/// (`FooTest.java`, `foo_test.go`, `foo.spec.ts`, `test_foo.py` all give `foo`).
fn subject(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path);
    let stem = name
        .rsplit_once('.')
        .map_or(name, |(s, _)| s)
        .to_ascii_lowercase();
    let mut stem = stem.as_str();
    for suffix in [
        ".test", ".spec", "_test", "_spec", "-test", "-spec", "tests", "test",
    ] {
        if let Some(rest) = stem.strip_suffix(suffix) {
            stem = rest;
            break;
        }
    }
    for prefix in ["test_", "test-"] {
        if let Some(rest) = stem.strip_prefix(prefix) {
            stem = rest;
            break;
        }
    }
    stem.trim_end_matches(['_', '-', '.']).to_owned()
}

pub struct TestIndex {
    subjects: HashSet<String>,
    pub repo_tests: u32,
}

impl TestIndex {
    /// `files` are `(path, is_test)` for every file of the repository.
    pub fn build<'a>(files: impl Iterator<Item = (&'a str, bool)>) -> Self {
        let mut subjects = HashSet::new();
        let mut repo_tests = 0;
        for (path, test) in files {
            if test {
                repo_tests += 1;
                let s = subject(path);
                if !s.is_empty() {
                    subjects.insert(s);
                }
            }
        }
        Self {
            subjects,
            repo_tests,
        }
    }

    pub fn links(
        &self,
        path: &str,
        relative: &RootRelativePath,
        facts: &Facts<'_>,
        metrics: &FileMetrics,
    ) -> TestLinks {
        let dependents = facts.dependent_files(relative);
        let is_test =
            |p: &RootRelativePath| is_test_file(Path::new(&p.as_path().display().to_string()));
        let test_files = dependents.iter().filter(|(p, _)| is_test(p)).count() as u32;
        let indirect = dependents
            .iter()
            .filter(|(p, _)| !is_test(p))
            .filter(|(p, _)| facts.dependent_files(p).iter().any(|(q, _)| is_test(q)))
            .count() as u32;
        let own = subject(path);
        TestLinks {
            test_files,
            indirect,
            sibling: !own.is_empty() && self.subjects.contains(&own),
            in_file: metrics.functions.iter().any(|f| f.test),
            repo_tests: self.repo_tests,
        }
    }

    /// Links of a file edited since the analysis: the import-based counts are kept, the rest is
    /// read again.
    pub fn refresh(
        &self,
        path: &str,
        known: Option<TestLinks>,
        metrics: &FileMetrics,
    ) -> TestLinks {
        let own = subject(path);
        TestLinks {
            sibling: !own.is_empty() && self.subjects.contains(&own),
            in_file: metrics.functions.iter().any(|f| f.test),
            repo_tests: self.repo_tests,
            ..known.unwrap_or_default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::subject;

    #[test]
    fn test_markers_are_removed_in_every_convention() {
        for name in [
            "src/FooTest.java",
            "pkg/foo_test.go",
            "web/foo.spec.ts",
            "web/foo.test.tsx",
            "app/test_foo.py",
            "spec/foo_spec.rb",
            "src/Foo.cs",
        ] {
            assert_eq!(subject(name), "foo", "{name}");
        }
        assert_eq!(subject("src/lib.rs"), "lib");
    }
}
