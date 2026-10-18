use std::collections::BTreeMap;

use harness_code_health::{
    registry,
    rollup::{
        folder_rollups, repository_health, self_check, Band, FileHealth, RollupConfig,
        SelfCheckConfig,
    },
    Severity,
};

use super::{
    super::{entry::Entry, error::RepositoryError},
    analyse::FileAnalysis,
    model::{DetectorSummary, HealthFileRow, HealthReport, SeverityCounts},
};

const FOLDER_DEPTH: usize = 1;
/// Files listed per detector.
const EXAMPLES: usize = 20;

pub(super) fn count(counts: &mut SeverityCounts, severity: Severity) {
    match severity {
        Severity::Critical => counts.critical += 1,
        Severity::High => counts.high += 1,
        Severity::Medium => counts.medium += 1,
        Severity::Low => counts.low += 1,
    }
}

pub(super) fn row(file: &FileAnalysis) -> HealthFileRow {
    let mut findings = SeverityCounts::default();
    for finding in &file.findings {
        count(&mut findings, finding.severity);
    }
    let top_issue = file.score.as_ref().and_then(|score| {
        file.findings
            .iter()
            .max_by(|a, b| {
                let (ia, ib) = (
                    score.impacts.get(&a.id).copied().unwrap_or(0.0),
                    score.impacts.get(&b.id).copied().unwrap_or(0.0),
                );
                ia.total_cmp(&ib)
                    .then(a.severity.cmp(&b.severity))
                    .then(b.id.cmp(&a.id))
            })
            .map(|f| f.reason.clone())
    });
    HealthFileRow {
        path: file.path.clone(),
        language: file.language.clone(),
        nloc: file.metrics.as_ref().map_or(0, |m| m.nloc),
        test: file.test,
        hotspot: file.signals.as_ref().is_some_and(|s| s.hotspot),
        defect: file.score.as_ref().map(|s| s.defect.score),
        maintainability: file.score.as_ref().map(|s| s.maintainability.score),
        band: file.score.as_ref().map(|s| Band::of(s.defect.score)),
        structure: file.score.as_ref().map_or(0.0, |s| s.structure_deduction),
        history: file.score.as_ref().map_or(0.0, |s| s.history_deduction),
        findings,
        top_issue,
    }
}

pub(super) fn file_health(file: &FileAnalysis) -> FileHealth {
    FileHealth {
        path: file.path.clone(),
        nloc: file.metrics.as_ref().map_or(0, |m| m.nloc),
        test: file.test,
        hotspot: file.signals.as_ref().is_some_and(|s| s.hotspot),
        score: file.score.clone(),
        fix_commits: file.signals.as_ref().map(|s| s.fix_commits),
    }
}

impl Entry {
    pub fn code_health(&self) -> Result<HealthReport, RepositoryError> {
        let analysis = self.health_analysis()?;
        let health: Vec<FileHealth> = analysis.files.iter().map(file_health).collect();
        let window = analysis.summary.as_ref().map_or(180, |s| s.fix_window_days);
        let mut rows: Vec<HealthFileRow> = analysis.files.iter().map(row).collect();
        rows.sort_by(|a, b| match (a.defect, b.defect) {
            (Some(x), Some(y)) => x
                .total_cmp(&y)
                .then((b.structure + b.history).total_cmp(&(a.structure + a.history)))
                .then(a.path.cmp(&b.path)),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => a.path.cmp(&b.path),
        });
        let rank: std::collections::HashMap<&str, usize> = rows
            .iter()
            .enumerate()
            .map(|(i, r)| (r.path.as_str(), i))
            .collect();
        let mut by_detector: BTreeMap<String, (std::collections::BTreeSet<&str>, SeverityCounts)> =
            BTreeMap::new();
        for file in &analysis.files {
            for finding in &file.findings {
                let entry = by_detector.entry(finding.detector.clone()).or_default();
                entry.0.insert(file.path.as_str());
                count(&mut entry.1, finding.severity);
            }
        }
        let mut detectors: Vec<DetectorSummary> = registry()
            .iter()
            .filter_map(|d| {
                let (files, findings) = by_detector.remove(d.id())?;
                let mut examples: Vec<&str> = files.iter().copied().collect();
                examples.sort_by_key(|path| rank.get(path).copied().unwrap_or(usize::MAX));
                examples.truncate(EXAMPLES);
                Some(DetectorSummary {
                    id: d.id().to_owned(),
                    category: d.category(),
                    summary: d.summary().to_owned(),
                    files: files.len(),
                    findings,
                    examples: examples.into_iter().map(str::to_owned).collect(),
                })
            })
            .collect();
        let total = |c: &SeverityCounts| c.critical + c.high + c.medium + c.low;
        detectors.sort_by(|a, b| {
            total(&b.findings)
                .cmp(&total(&a.findings))
                .then(a.id.cmp(&b.id))
        });
        let mut languages: Vec<String> = analysis
            .files
            .iter()
            .filter(|f| f.metrics.is_some())
            .map(|f| f.language.clone())
            .collect();
        languages.sort();
        languages.dedup();
        Ok(HealthReport {
            snapshot: analysis.snapshot.clone(),
            repository: repository_health(&health, &RollupConfig::default()),
            self_check: self_check(&health, window, &SelfCheckConfig::default()),
            folders: folder_rollups(&health, FOLDER_DEPTH),
            findings: analysis.files.iter().map(|f| f.findings.len()).sum(),
            detectors,
            history: analysis.summary.is_some(),
            languages_measured: languages,
            files: rows,
        })
    }
}
