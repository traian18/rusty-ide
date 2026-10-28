//! One measurement of a goal's scope, for the goal loop: each file's code health measured from the
//! disk now (structure only: change history is not something a pass can fix), the guideline errors
//! in it, and a fingerprint of the files so a pass that changed nothing is seen as such.
use std::sync::Arc;

use harness_code_health::{score_file, Category, Finding};
use harness_goals::{FileMeasure, FindingSummary, GuidelineSummary, Measurement, Severity};
use harness_guidelines::{Glob, Severity as RuleSeverity};
use serde_json::json;
use sha2::{Digest, Sha256};

use super::{
    entry::Entry,
    error::RepositoryError,
    guidelines::{check_paths, load, CheckOptions},
    health::analyse::analyse_live,
    registry::RepositoryState,
    routing::route,
};

/// Files one measurement covers at most.
pub const MAX_FILES: usize = 40;
const FINDINGS_PER_FILE: usize = 8;

fn severity(finding: &Finding) -> Severity {
    match finding.severity {
        harness_code_health::Severity::Low => Severity::Low,
        harness_code_health::Severity::Medium => Severity::Medium,
        harness_code_health::Severity::High => Severity::High,
        harness_code_health::Severity::Critical => Severity::Critical,
    }
}

fn round(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

/// `relative` (inside `entry`) measured now; `path` is how the workspace names it.
fn measure_file(
    entry: &Entry,
    path: &str,
    relative: &str,
) -> Result<(FileMeasure, Vec<GuidelineSummary>, u32), RepositoryError> {
    let analysis = entry.health_analysis()?;
    let (score, findings) = match analyse_live(entry, &analysis, relative) {
        Some(live) => {
            let code: Vec<Finding> = live
                .findings
                .into_iter()
                .filter(|f| f.category != Category::Organizational)
                .collect();
            let scored = score_file(&code, &analysis.scoring);
            let mut findings: Vec<FindingSummary> = code
                .iter()
                .map(|f| FindingSummary {
                    id: f.id.clone(),
                    issue: f.detector.replace('_', " "),
                    severity: severity(f),
                    lines: format!("{}-{}", f.start_line, f.end_line),
                    reason: f.reason.clone(),
                    worth: round(scored.impacts.get(&f.id).copied().unwrap_or(0.0)),
                })
                .collect();
            findings.sort_by(|a, b| b.worth.total_cmp(&a.worth));
            findings.truncate(FINDINGS_PER_FILE);
            (Some(round(scored.defect.score)), findings)
        }
        None => (None, Vec::new()),
    };
    let (mut errors, mut warnings) = (Vec::new(), 0);
    if let Ok(guidelines) = load(entry.root()).guidelines {
        for report in check_paths(
            entry,
            &guidelines,
            &[relative.to_owned()],
            CheckOptions::default(),
        ) {
            for violation in report.violations {
                match violation.severity {
                    RuleSeverity::Error => errors.push(GuidelineSummary {
                        rule: violation.rule,
                        path: path.to_owned(),
                        line: violation.start_line,
                        message: violation.message,
                    }),
                    RuleSeverity::Warn => warnings += 1,
                    RuleSeverity::Info => {}
                }
            }
        }
    }
    Ok((
        FileMeasure {
            path: path.to_owned(),
            score,
            findings,
        },
        errors,
        warnings,
    ))
}

/// The workspace-relative files `scope` names: files as they are, folders as everything under them,
/// globs over the indexed source files of every repository. An empty scope means `touched`.
async fn files_in(
    state: &RepositoryState,
    workspace: &str,
    scope: &[String],
    touched: &[String],
) -> Result<Vec<String>, RepositoryError> {
    let wanted: &[String] = if scope.is_empty() { touched } else { scope };
    let root = std::path::Path::new(workspace);
    let mut files = Vec::new();
    let mut globs = Vec::new();
    for item in wanted {
        let item = item.trim().trim_start_matches("./").trim_end_matches('/');
        let full = root.join(item);
        if full.is_file() {
            files.push(item.to_owned());
        } else if full.is_dir() {
            globs.push(Glob::new(&format!("{item}/**")).map_err(RepositoryError::invalid)?);
        } else if item.contains(['*', '?', '{']) {
            globs.push(Glob::new(item).map_err(RepositoryError::invalid)?);
        }
    }
    if !globs.is_empty() {
        for repository in state.directory().repositories(workspace)?.iter() {
            let entry = state.entry(&repository.root.to_string_lossy())?;
            if entry.snapshot().is_err() {
                entry.refresh(true).await?;
            }
            let snapshot = entry.snapshot()?;
            for file in &snapshot.imports.files {
                let inside = file.path.as_path().to_string_lossy().replace('\\', "/");
                let path = if repository.relative.is_empty() {
                    inside
                } else {
                    format!("{}/{inside}", repository.relative)
                };
                if globs.iter().any(|g| g.matches(&path)) {
                    files.push(path);
                }
            }
        }
    }
    files.sort();
    files.dedup();
    files.truncate(MAX_FILES);
    Ok(files)
}

/// Measures a goal's scope now. Checks are not run here: the caller adds what the pass ran.
pub async fn measure(
    state: &RepositoryState,
    workspace: &str,
    active: Option<&str>,
    scope: &[String],
    touched: &[String],
) -> Result<Measurement, RepositoryError> {
    let files = files_in(state, workspace, scope, touched).await?;
    let mut measurement = Measurement {
        files: Vec::new(),
        guideline_errors: Vec::new(),
        guideline_warnings: 0,
        checks: Vec::new(),
        fingerprint: String::new(),
    };
    let mut hasher = Sha256::new();
    for path in files {
        let (repository, arguments) = route(state, workspace, active, json!({"targets": [path]}))?;
        let relative = arguments["targets"][0].as_str().unwrap_or(&path).to_owned();
        let entry: Arc<Entry> = state.entry(&repository.root.to_string_lossy())?;
        if entry.snapshot().is_err() {
            entry.refresh(true).await?;
        }
        hasher.update(path.as_bytes());
        hasher.update(std::fs::read(entry.root().join(&relative)).unwrap_or_default());
        let (named, worked) = (path.clone(), entry.clone());
        let (file, errors, warnings) =
            tauri::async_runtime::spawn_blocking(move || measure_file(&worked, &named, &relative))
                .await
                .map_err(|e| RepositoryError::new("internal", e.to_string()))??;
        measurement.files.push(file);
        measurement.guideline_errors.extend(errors);
        measurement.guideline_warnings += warnings;
    }
    measurement.fingerprint = format!("{:x}", hasher.finalize());
    Ok(measurement)
}
