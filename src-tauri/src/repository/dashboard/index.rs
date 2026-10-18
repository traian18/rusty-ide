//! One row per indexed file with what the dashboard shows about it, joined from the repository
//! snapshot, the Git analysis and the findings. Built per request; only line counts are cached,
//! by content hash, because counting reads every file.
use std::{
    collections::{BTreeMap, HashMap},
    sync::Mutex,
};

use harness_findings::{FindingSet, Severity};
use harness_git_analysis::GitSnapshot;
use harness_repository_wiki::{facts::Facts, tests_of::is_test_file};
use harness_workspace::{
    import_graph::LanguageProfile,
    repository_intelligence::{RepositoryGraph, RepositorySnapshot},
};

use super::{super::dto::SeverityCounts, model::FileRow};

/// Largest file counted; bigger files count as their size in 80-character lines.
const MAX_COUNTED_BYTES: u64 = 4 * 1024 * 1024;

/// Line counts by content hash, kept across snapshots: an unchanged file is never read twice.
#[derive(Default)]
pub struct LineCounts(Mutex<HashMap<String, u32>>);

impl LineCounts {
    fn count(&self, graph: &dyn RepositoryGraph, snapshot: &RepositorySnapshot) -> Vec<u32> {
        let mut cache = self.0.lock().unwrap_or_else(|e| e.into_inner());
        snapshot
            .imports
            .files
            .iter()
            .map(|file| {
                if let Some(lines) = cache.get(&file.content_hash) {
                    return *lines;
                }
                let lines = match graph.read_file(&file.path, MAX_COUNTED_BYTES) {
                    Ok(bytes) => {
                        let newlines = bytes.iter().filter(|b| **b == b'\n').count();
                        let trailing = usize::from(bytes.last().is_some_and(|b| *b != b'\n'));
                        (newlines + trailing) as u32
                    }
                    Err(_) => 0,
                };
                cache.insert(file.content_hash.clone(), lines);
                lines
            })
            .collect()
    }
}

pub fn language_name(profile: LanguageProfile) -> String {
    match profile {
        LanguageProfile::Rust => "rust",
        LanguageProfile::TypeScript => "typescript",
        LanguageProfile::JavaScript => "javascript",
        LanguageProfile::Python => "python",
        LanguageProfile::Go => "go",
        LanguageProfile::Java => "java",
        LanguageProfile::CSharp => "csharp",
        LanguageProfile::Php => "php",
        LanguageProfile::C => "c",
        LanguageProfile::Cpp => "cpp",
    }
    .to_owned()
}

pub fn severity_name(severity: Severity) -> &'static str {
    match severity {
        Severity::High => "high",
        Severity::Medium => "medium",
        Severity::Low => "low",
        Severity::Info => "info",
    }
}

pub fn add_severity(counts: &mut SeverityCounts, severity: Severity) {
    match severity {
        Severity::High => counts.high += 1,
        Severity::Medium => counts.medium += 1,
        Severity::Low => counts.low += 1,
        Severity::Info => counts.info += 1,
    }
}

pub fn add_counts(into: &mut SeverityCounts, from: &SeverityCounts) {
    into.high += from.high;
    into.medium += from.medium;
    into.low += from.low;
    into.info += from.info;
}

/// The main author's share above which a file counts as having a single owner.
pub const SINGLE_OWNER_SHARE: f64 = 0.8;

pub struct FileIndex {
    pub rows: Vec<FileRow>,
    pub latest_change: Option<i64>,
}

impl FileIndex {
    pub fn build(
        graph: &dyn RepositoryGraph,
        snapshot: &RepositorySnapshot,
        git: Option<&GitSnapshot>,
        findings: Option<&FindingSet>,
        lines: &LineCounts,
    ) -> Self {
        let facts = Facts::new(snapshot);
        let counts = lines.count(graph, snapshot);
        let churn: HashMap<String, _> = git
            .map(|g| {
                g.index
                    .churn
                    .iter()
                    .map(|c| (c.file.as_path().display().to_string(), c))
                    .collect()
            })
            .unwrap_or_default();
        let owners: HashMap<String, _> = git
            .map(|g| {
                g.index
                    .contributors
                    .iter()
                    .filter_map(|c| {
                        c.entries
                            .first()
                            .map(|top| (c.file.as_path().display().to_string(), top))
                    })
                    .collect()
            })
            .unwrap_or_default();
        let mut by_file: HashMap<String, SeverityCounts> = HashMap::new();
        for finding in findings.map(|s| s.findings.as_slice()).unwrap_or_default() {
            for file in &finding.subjects {
                add_severity(
                    by_file
                        .entry(file.as_path().display().to_string())
                        .or_default(),
                    finding.severity,
                );
            }
        }
        let mut rows: Vec<FileRow> = snapshot
            .imports
            .files
            .iter()
            .zip(counts)
            .map(|(file, lines)| {
                let path = file.path.as_path().display().to_string();
                let importers = facts.dependent_files(&file.path).len();
                let mut imported: BTreeMap<String, ()> = BTreeMap::new();
                for edge in facts.imports_of(&file.path) {
                    if let harness_workspace::import_graph::Resolution::ResolvedInternal {
                        target_file,
                        ..
                    } = &edge.resolution
                    {
                        imported.insert(target_file.as_path().display().to_string(), ());
                    }
                }
                let churn = churn.get(&path);
                let owner = owners.get(&path);
                FileRow {
                    language: language_name(file.profile),
                    package: facts.package_of(&file.path).map(str::to_owned),
                    lines,
                    importers,
                    imports: imported.len(),
                    dependents: 0,
                    commits: churn.map_or(0, |c| c.commits),
                    lines_changed: churn.map_or(0, |c| c.lines_added + c.lines_removed),
                    contributors: churn.map_or(0, |c| c.contributors),
                    owner: owner.map(|o| o.contributor.name.clone()),
                    owner_share: owner.map(|o| f64::from(o.commit_share_per_mille) / 1000.0),
                    last_change: churn.map(|c| c.last_change),
                    findings: by_file.remove(&path).unwrap_or_default(),
                    test: is_test_file(file.path.as_path()),
                    path,
                }
            })
            .collect();
        // Percentile of importer counts: the share of files imported by fewer files.
        let mut sorted: Vec<usize> = rows.iter().map(|r| r.importers).collect();
        sorted.sort_unstable();
        let n = sorted.len().max(1);
        for row in &mut rows {
            if row.importers > 0 {
                let below = sorted.partition_point(|c| *c < row.importers);
                row.dependents = ((below * 100) / n) as u32;
            }
        }
        rows.sort_by(|a, b| a.path.cmp(&b.path));
        let latest_change = git.and_then(|g| g.coverage.latest_commit_time);
        Self {
            rows,
            latest_change,
        }
    }

    /// Languages by total lines, most first.
    pub fn language_ranks(&self) -> Vec<(String, usize, u64)> {
        let mut by: BTreeMap<&str, (usize, u64)> = BTreeMap::new();
        for row in &self.rows {
            let entry = by.entry(&row.language).or_default();
            entry.0 += 1;
            entry.1 += u64::from(row.lines);
        }
        let mut out: Vec<(String, usize, u64)> = by
            .into_iter()
            .map(|(l, (f, n))| (l.to_owned(), f, n))
            .collect();
        out.sort_by(|a, b| b.2.cmp(&a.2).then(a.0.cmp(&b.0)));
        out
    }
}
