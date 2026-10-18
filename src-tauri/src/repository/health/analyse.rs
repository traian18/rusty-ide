//! Every file of the snapshot through metrics, detectors and scoring.
use std::{collections::HashMap, sync::Arc};

use harness_code_analysis::{
    metrics::{measure_file, FileMetrics},
    LanguageId,
};
use harness_code_health::{
    detect_file, score_file, DetectorConfig, FileContext, FileScore, Finding, ScoringConfig,
};
use harness_git_analysis::{FileSignals, SignalSummary};
use harness_repository_wiki::{facts::Facts, tests_of::is_test_file};
use harness_workspace::{
    import_graph::LanguageProfile, repository_intelligence::RepositorySnapshot,
};

use super::{super::entry::Entry, cache::HealthCache};

/// Largest file measured.
const MAX_BYTES: u64 = 2 * 1024 * 1024;

pub struct FileAnalysis {
    pub path: String,
    pub language: String,
    /// `None` when the language is not measured or the file could not be read.
    pub metrics: Option<Arc<FileMetrics>>,
    pub findings: Vec<Finding>,
    pub score: Option<FileScore>,
    pub signals: Option<FileSignals>,
    pub test: bool,
    pub importers: u32,
}

pub struct Analysis {
    pub snapshot: String,
    pub files: Vec<FileAnalysis>,
    pub summary: Option<SignalSummary>,
    pub detectors: DetectorConfig,
    pub scoring: ScoringConfig,
    /// The measurement cache keys this analysis used, so only those are saved.
    pub metric_keys: Vec<String>,
}

fn language(profile: LanguageProfile, path: &str) -> (Option<LanguageId>, &'static str) {
    match profile {
        LanguageProfile::Rust => (Some(LanguageId::Rust), "rust"),
        LanguageProfile::TypeScript => (Some(LanguageId::TypeScript), "typescript"),
        LanguageProfile::JavaScript => (Some(LanguageId::JavaScript), "javascript"),
        LanguageProfile::Python => (Some(LanguageId::Python), "python"),
        LanguageProfile::Go => (None, "go"),
        LanguageProfile::Java => (None, "java"),
        LanguageProfile::CSharp => (None, "csharp"),
        LanguageProfile::Php => (None, "php"),
        LanguageProfile::C => (None, "c"),
        LanguageProfile::Cpp => (None, if path.ends_with(".h") { "c" } else { "cpp" }),
    }
}

/// The 80th percentile of importers per file (nearest rank).
fn p80(mut counts: Vec<u32>) -> Option<u32> {
    if counts.is_empty() {
        return None;
    }
    counts.sort_unstable();
    let rank = (counts.len() * 80).div_ceil(100).max(1);
    counts.get(rank - 1).copied()
}

pub fn analyse(entry: &Entry, snapshot: &RepositorySnapshot, cache: &HealthCache) -> Analysis {
    let git = entry.git.current();
    let signals: HashMap<String, &FileSignals> = git
        .as_ref()
        .map(|g| {
            g.index
                .signals
                .iter()
                .map(|s| (s.file.as_path().display().to_string(), s))
                .collect()
        })
        .unwrap_or_default();
    let facts = Facts::new(snapshot);
    let importers: Vec<u32> = snapshot
        .imports
        .files
        .iter()
        .map(|f| facts.dependent_files(&f.path).len() as u32)
        .collect();
    let repo_p80 = p80(importers.clone());
    let detectors = DetectorConfig::default();
    let scoring = ScoringConfig::default();
    let summary = git.as_ref().map(|g| g.index.signal_summary.clone());
    let files = snapshot
        .imports
        .files
        .iter()
        .zip(importers)
        .map(|(file, importers)| {
            let path = file.path.as_path().display().to_string();
            let (id, name) = language(file.profile, &path);
            let key = format!("{name}:{}", file.content_hash);
            let metrics = id.and_then(|id| {
                cache.metrics(&key, || {
                    let bytes = entry.graph.read_file(&file.path, MAX_BYTES).ok()?;
                    measure_file(&id, &path, &bytes).ok()
                })
            });
            let test = is_test_file(file.path.as_path());
            let file_signals = signals.get(&path).map(|s| (*s).clone());
            let (findings, score) = match &metrics {
                Some(m) => {
                    let mut context = FileContext::new(&path, m)
                        .with_importers(importers, repo_p80)
                        .with_test(test);
                    if let (Some(s), Some(summary)) = (signals.get(&path), summary.as_ref()) {
                        context = context.with_history(s, summary);
                    }
                    let findings = detect_file(&context, &detectors);
                    let score = score_file(&findings, &scoring);
                    (findings, Some(score))
                }
                None => (Vec::new(), None),
            };
            let measured = metrics.is_some().then_some(key);
            let file = FileAnalysis {
                path,
                language: name.to_owned(),
                metrics,
                findings,
                score,
                signals: file_signals,
                test,
                importers,
            };
            (file, measured)
        })
        .collect::<Vec<_>>();
    let metric_keys = files.iter().filter_map(|(_, key)| key.clone()).collect();
    Analysis {
        snapshot: snapshot.id.0.clone(),
        files: files.into_iter().map(|(file, _)| file).collect(),
        summary,
        detectors,
        scoring,
        metric_keys,
    }
}

impl Entry {
    pub(in crate::repository) fn health_analysis(
        &self,
    ) -> Result<Arc<Analysis>, super::super::error::RepositoryError> {
        let snapshot = self.snapshot()?;
        let git = self
            .git
            .current()
            .map(|g| g.id.0.clone())
            .unwrap_or_default();
        let key = format!("{}:{git}", snapshot.id.0);
        Ok(self
            .health
            .analysis(&key, || analyse(self, &snapshot, &self.health)))
    }
}
