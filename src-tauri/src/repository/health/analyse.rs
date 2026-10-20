//! Every file of the snapshot through metrics, detectors and scoring.
use std::{collections::HashMap, sync::Arc};

use harness_code_analysis::{
    metrics::{measure_file, FileMetrics, METRICS_VERSION},
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
    /// What links the file to tests; `None` for files that are not source code.
    pub links: Option<harness_code_health::TestLinks>,
    /// Lines of code: from the metrics, or the non-blank lines of an infrastructure file.
    pub nloc: u32,
}

pub struct Analysis {
    pub snapshot: String,
    pub files: Vec<FileAnalysis>,
    pub summary: Option<SignalSummary>,
    pub detectors: DetectorConfig,
    pub scoring: ScoringConfig,
    /// The measurement cache keys this analysis used, so only those are saved.
    pub metric_keys: Vec<String>,
    /// Infrastructure files' relations, for rules and the repository overview.
    pub infra: super::infra::InfraState,
    /// Near copies of functions across the repository.
    pub duplicates: harness_code_health::duplication::DuplicateIndex,
    /// Which tests exist, by what they are named after.
    pub tests: super::tests_link::TestIndex,
}

fn language(profile: LanguageProfile, path: &str) -> (Option<LanguageId>, &'static str) {
    match profile {
        LanguageProfile::Rust => (Some(LanguageId::Rust), "rust"),
        LanguageProfile::TypeScript => (Some(LanguageId::TypeScript), "typescript"),
        LanguageProfile::JavaScript => (Some(LanguageId::JavaScript), "javascript"),
        LanguageProfile::Python => (Some(LanguageId::Python), "python"),
        LanguageProfile::Go => (Some(LanguageId::Go), "go"),
        LanguageProfile::Java => (Some(LanguageId::Java), "java"),
        LanguageProfile::Kotlin => (Some(LanguageId::Kotlin), "kotlin"),
        LanguageProfile::CSharp => (Some(LanguageId::CSharp), "csharp"),
        LanguageProfile::Php => (Some(LanguageId::Php), "php"),
        // C is measured with the C++ grammar, which parses it.
        LanguageProfile::C => (Some(LanguageId::Cpp), "c"),
        LanguageProfile::Cpp => (
            Some(LanguageId::Cpp),
            if path.ends_with(".h") { "c" } else { "cpp" },
        ),
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
    let scoring = harness_infra_analysis::scoring_config();
    let summary = git.as_ref().map(|g| g.index.signal_summary.clone());
    struct Measured {
        path: String,
        relative: harness_workspace::repository_intelligence::RootRelativePath,
        name: &'static str,
        key: String,
        metrics: Option<Arc<FileMetrics>>,
        test: bool,
        importers: u32,
    }
    // Pass one: measure every file (cached by content). Duplication and test links compare files
    // with each other, so findings come after all measurements exist.
    let measured: Vec<Measured> = snapshot
        .imports
        .files
        .iter()
        .zip(importers)
        .map(|(file, importers)| {
            let path = file.path.as_path().display().to_string();
            let (id, name) = language(file.profile, &path);
            let key = format!("{name}:v{METRICS_VERSION}:{}", file.content_hash);
            let metrics = id.and_then(|id| {
                cache.metrics(&key, || {
                    let bytes = entry.graph.read_file(&file.path, MAX_BYTES).ok()?;
                    measure_file(&id, &path, &bytes).ok()
                })
            });
            let test = is_test_file(file.path.as_path());
            Measured {
                path,
                relative: file.path.clone(),
                name,
                key,
                metrics,
                test,
                importers,
            }
        })
        .collect();
    let tests =
        super::tests_link::TestIndex::build(measured.iter().map(|m| (m.path.as_str(), m.test)));
    let duplicates = harness_code_health::duplication::DuplicateIndex::build(
        measured
            .iter()
            .filter_map(|m| m.metrics.as_deref().map(|x| (m.path.as_str(), x, m.test))),
        &detectors.duplicated_code,
    );
    let files = measured
        .into_iter()
        .map(|m| {
            let file_signals = signals.get(&m.path).map(|s| (*s).clone());
            let mut links = None;
            let (findings, score) = match &m.metrics {
                Some(metrics) => {
                    let found = tests.links(&m.path, &m.relative, &facts, metrics);
                    links = Some(found);
                    let mut context = FileContext::new(&m.path, metrics)
                        .with_importers(m.importers, repo_p80)
                        .with_test(m.test)
                        .with_duplicates(duplicates.duplicates_in(&m.path))
                        .with_tests(&found);
                    if let (Some(s), Some(summary)) = (signals.get(&m.path), summary.as_ref()) {
                        context = context.with_history(s, summary);
                    }
                    let findings = detect_file(&context, &detectors);
                    let score = score_file(&findings, &scoring);
                    (findings, Some(score))
                }
                None => (Vec::new(), None),
            };
            let measured_key = m.metrics.is_some().then_some(m.key);
            let file = FileAnalysis {
                nloc: m.metrics.as_ref().map_or(0, |x| x.nloc),
                path: m.path,
                language: m.name.to_owned(),
                metrics: m.metrics,
                findings,
                score,
                signals: file_signals,
                test: m.test,
                importers: m.importers,
                links,
            };
            (file, measured_key)
        })
        .collect::<Vec<_>>();
    let metric_keys = files.iter().filter_map(|(_, key)| key.clone()).collect();
    let mut files: Vec<FileAnalysis> = files.into_iter().map(|(file, _)| file).collect();
    let known: std::collections::HashSet<String> = files.iter().map(|f| f.path.clone()).collect();
    let mut infra = super::infra::analyse_infra(&entry.root, &known, &signals, summary.as_ref());
    files.append(&mut infra.files);
    Analysis {
        snapshot: snapshot.id.0.clone(),
        files,
        summary,
        detectors,
        scoring,
        metric_keys,
        infra,
        duplicates,
        tests,
    }
}

/// The measured language for a language name as [`FileAnalysis::language`] holds it, or for a
/// file extension when the file is not in the index.
pub(in crate::repository) fn language_id(name_or_path: &str) -> Option<LanguageId> {
    let extension = name_or_path.rsplit('.').next().unwrap_or(name_or_path);
    match (name_or_path, extension) {
        ("rust", _) | (_, "rs") => Some(LanguageId::Rust),
        ("typescript", _) | (_, "ts" | "tsx" | "mts" | "cts") => Some(LanguageId::TypeScript),
        ("javascript", _) | (_, "js" | "jsx" | "mjs" | "cjs") => Some(LanguageId::JavaScript),
        ("python", _) | (_, "py") => Some(LanguageId::Python),
        ("java", _) | (_, "java") => Some(LanguageId::Java),
        ("kotlin", _) | (_, "kt" | "kts") => Some(LanguageId::Kotlin),
        ("csharp", _) | (_, "cs") => Some(LanguageId::CSharp),
        ("go", _) | (_, "go") => Some(LanguageId::Go),
        ("php", _) | (_, "php") => Some(LanguageId::Php),
        ("cpp" | "c", _) | (_, "c" | "cc" | "cpp" | "cxx" | "h" | "hh" | "hpp" | "hxx") => {
            Some(LanguageId::Cpp)
        }
        ("ruby", _) | (_, "rb") => Some(LanguageId::Ruby),
        _ => None,
    }
}

/// One file measured from the disk as it is now, scored with the importers and history that
/// `analysis` holds for it, so an agent can see whether an edit made it better or worse before
/// anything is re-indexed. `None` when the file cannot be read or its language is not measured.
pub(in crate::repository) fn analyse_live(
    entry: &Entry,
    analysis: &Analysis,
    path: &str,
) -> Option<FileAnalysis> {
    let known = analysis.files.iter().find(|f| f.path == path);
    let Some(id) = language_id(known.map_or(path, |f| f.language.as_str())) else {
        return analyse_infra_live(entry, analysis, path, known);
    };
    let bytes = std::fs::read(entry.root().join(path)).ok()?;
    if bytes.len() as u64 > MAX_BYTES {
        return None;
    }
    let metrics = Arc::new(measure_file(&id, path, &bytes).ok()?);
    let importers = known.map_or(0, |f| f.importers);
    let repo_p80 = p80(analysis.files.iter().map(|f| f.importers).collect());
    let test = known.map_or_else(|| is_test_file(std::path::Path::new(path)), |f| f.test);
    let signals = known.and_then(|f| f.signals.clone());
    let duplicates =
        analysis
            .duplicates
            .duplicates_for(path, &metrics, &analysis.detectors.duplicated_code);
    let links = analysis
        .tests
        .refresh(path, known.and_then(|f| f.links), &metrics);
    let mut context = FileContext::new(path, &metrics)
        .with_importers(importers, repo_p80)
        .with_test(test)
        .with_duplicates(&duplicates)
        .with_tests(&links);
    if let (Some(s), Some(summary)) = (signals.as_ref(), analysis.summary.as_ref()) {
        context = context.with_history(s, summary);
    }
    let findings = detect_file(&context, &analysis.detectors);
    let score = score_file(&findings, &analysis.scoring);
    let nloc = metrics.nloc;
    Some(FileAnalysis {
        path: path.to_owned(),
        language: known.map_or_else(|| format!("{id:?}").to_lowercase(), |f| f.language.clone()),
        metrics: Some(metrics),
        findings,
        score: Some(score),
        signals,
        test,
        importers,
        links: Some(links),
        nloc,
    })
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

/// An infrastructure file as it is on disk now, with the relations and history the analysis
/// holds for it.
fn analyse_infra_live(
    entry: &Entry,
    analysis: &Analysis,
    path: &str,
    known: Option<&FileAnalysis>,
) -> Option<FileAnalysis> {
    if !harness_infra_analysis::is_candidate(path) {
        return None;
    }
    let text = std::fs::read_to_string(entry.root().join(path)).ok()?;
    if text.len() as u64 > MAX_BYTES {
        return None;
    }
    let context = harness_infra_analysis::InfraContext {
        repo_files: Some(&analysis.infra.all_paths),
        graph: Some(&analysis.infra.graph),
    };
    let (kind, mut findings) = harness_infra_analysis::analyse(
        path,
        &text,
        &context,
        &harness_infra_analysis::InfraConfig::default(),
    )?;
    let nloc = super::infra::nloc(&text);
    let signals = known.and_then(|f| f.signals.clone());
    if let (Some(s), Some(summary)) = (signals.as_ref(), analysis.summary.as_ref()) {
        findings.extend(harness_infra_analysis::history_findings(
            path, nloc, s, summary,
        ));
    }
    let score = score_file(&findings, &analysis.scoring);
    Some(FileAnalysis {
        path: path.to_owned(),
        language: kind.name().to_owned(),
        metrics: None,
        findings,
        score: Some(score),
        signals,
        test: false,
        importers: 0,
        links: None,
        nloc,
    })
}
