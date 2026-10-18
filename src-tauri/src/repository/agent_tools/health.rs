//! `repo_health`: the repository's code health with what to fix first; or, for named files, their
//! health measured from the disk now next to what the index holds, so an agent sees whether an
//! edit made a file better or worse; or one finding with the instructions to fix it.
use harness_code_health::{Category, Finding};
use serde_json::{json, Value};

use super::{
    super::{
        entry::Entry,
        error::RepositoryError,
        health::{
            analyse::{analyse_live, Analysis, FileAnalysis},
            report::row,
        },
    },
    envelope::{next, Args, Envelope},
};

const KNOWN: [&str; 4] = ["targets", "finding", "limit", "budget"];
const MAX_TARGETS: usize = 10;
const FINDINGS_PER_FILE: usize = 12;

fn finding_json(finding: &Finding, impact: f64) -> Value {
    json!({
        "id": finding.id,
        "issue": finding.detector.replace('_', " "),
        "severity": format!("{:?}", finding.severity).to_lowercase(),
        "lines": if finding.category == Category::Organizational { "whole file (change history)".to_owned() } else { format!("{}-{}", finding.start_line, finding.end_line) },
        "in": finding.function.as_ref().or(finding.class.as_ref()),
        "reason": finding.reason,
        "worth": (impact * 100.0).round() / 100.0,
    })
}

fn impact(file: &FileAnalysis, finding: &Finding) -> f64 {
    file.score
        .as_ref()
        .and_then(|s| s.impacts.get(&finding.id).copied())
        .unwrap_or(0.0)
}

pub(super) fn findings_of(file: &FileAnalysis) -> Vec<Value> {
    let mut findings: Vec<&Finding> = file.findings.iter().collect();
    findings.sort_by(|a, b| impact(file, b).total_cmp(&impact(file, a)));
    findings
        .into_iter()
        .take(FINDINGS_PER_FILE)
        .map(|f| finding_json(f, impact(file, f)))
        .collect()
}

pub(super) fn round(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

/// Fix-first order: what a finding costs, more where the file changes often and many import it.
fn priority(file: &FileAnalysis, finding: &Finding) -> f64 {
    let hotspot = if file.signals.as_ref().is_some_and(|s| s.hotspot) {
        2.0
    } else {
        1.0
    };
    impact(file, finding) * hotspot * (1.0 + f64::from(file.importers).ln_1p())
}

/// Change-history findings are listed apart from the fix-first queue: no single edit fixes them.
const HISTORY_ROWS: usize = 3;

/// Findings outside tests, code findings or change-history findings, in fix-first order.
fn ranked(analysis: &Analysis, history: bool) -> Vec<(&FileAnalysis, &Finding)> {
    let mut queue: Vec<(&FileAnalysis, &Finding)> = analysis
        .files
        .iter()
        .filter(|f| !f.test)
        .flat_map(|f| f.findings.iter().map(move |finding| (f, finding)))
        .filter(|(_, finding)| (finding.category == Category::Organizational) == history)
        .collect();
    queue.sort_by(|a, b| priority(b.0, b.1).total_cmp(&priority(a.0, a.1)));
    queue
}

fn queue_rows(queue: &[(&FileAnalysis, &Finding)], limit: usize) -> Vec<Value> {
    queue
        .iter()
        .take(limit)
        .map(|(file, finding)| {
            let mut row = finding_json(finding, impact(file, finding));
            row["path"] = json!(file.path);
            row["hotspot"] = json!(file.signals.as_ref().is_some_and(|s| s.hotspot));
            row
        })
        .collect()
}

fn dashboard(
    entry: &Entry,
    analysis: &Analysis,
    limit: usize,
) -> Result<Envelope, RepositoryError> {
    let report = entry.code_health()?;
    let r = &report.repository;
    let queue = ranked(analysis, false);
    let fix_first = queue_rows(&queue, limit);
    let history = queue_rows(&ranked(analysis, true), HISTORY_ROWS);
    let worst: Vec<Value> = report
        .files
        .iter()
        .filter(|f| !f.test && f.defect.is_some())
        .take(limit)
        .map(|f| json!({"path": f.path, "score": f.defect.map(round), "band": f.band, "top_issue": f.top_issue}))
        .collect();
    let detectors: Vec<Value> = report
        .detectors
        .iter()
        .take(6)
        .map(|d| json!({"issue": d.id.replace('_', " "), "files": d.files, "what": d.summary}))
        .collect();
    let summary = match r.average {
        Some(score) => format!(
            "code health {:.1} of 10{}, {} findings; {} of {} files scored",
            score,
            r.band.map(|b| format!(" ({b:?})")).unwrap_or_default(),
            report.findings,
            r.file_count - r.unanalysed_count,
            r.file_count
        ),
        None => "no file of a measured language (Rust, TypeScript, JavaScript, Python) was scored"
            .to_owned(),
    };
    let mut envelope = Envelope::new("ok", summary)
        .section("repository", json!({
            "score": r.average.map(round), "band": r.band, "maintainability": r.maintainability_average.map(round),
            "hotspot_health": r.hotspot_health.map(round), "hotspots": r.hotspot_count,
            "history_included": report.history, "languages": report.languages_measured,
        }))
        .section("fix_first", json!(fix_first))
        .section(
            "change_history",
            if history.is_empty() {
                Value::Null
            } else {
                json!({"note": "files whose change pattern costs health; no single edit fixes these, look for what keeps them changing", "items": history})
            },
        )
        .section("worst_files", json!(worst))
        .section("top_issues", json!(detectors));
    if let Some((_, lead)) = queue.first() {
        envelope = envelope.next(next(
            "repo_health",
            json!({"finding": lead.id}),
            "how to fix the first item",
        ));
    }
    if queue.len() > limit {
        envelope = envelope.truncated("fix_first", queue.len(), "pass a larger limit (at most 25)");
    }
    Ok(envelope)
}

fn targets(entry: &Entry, analysis: &Analysis, paths: &[String]) -> Envelope {
    let mut rows = Vec::new();
    let mut better = 0;
    let mut worse = 0;
    for path in paths.iter().take(MAX_TARGETS) {
        let indexed = analysis.files.iter().find(|f| &f.path == path);
        let Some(live) = analyse_live(entry, analysis, path) else {
            rows.push(json!({"path": path, "status": if std::path::Path::new(&entry.root().join(path)).is_file() { "unsupported" } else { "not_found" },
                "note": "health is measured for Rust, TypeScript, JavaScript and Python files that exist"}));
            continue;
        };
        let now = row(&live);
        let before = indexed
            .and_then(|f| f.score.as_ref())
            .map(|s| s.defect.score);
        let change = match (before, now.defect) {
            (Some(b), Some(n)) if (n - b).abs() >= 0.05 => {
                if n > b {
                    better += 1
                } else {
                    worse += 1
                }
                Some(round(n - b))
            }
            (Some(_), Some(_)) => Some(0.0),
            _ => None,
        };
        let fixed: Vec<String> = indexed
            .map(|f| {
                f.findings
                    .iter()
                    .filter(|old| {
                        !live.findings.iter().any(|new| {
                            new.detector == old.detector
                                && new.function == old.function
                                && new.class == old.class
                        })
                    })
                    .map(|old| {
                        format!(
                            "{} in {}",
                            old.detector.replace('_', " "),
                            old.function
                                .as_deref()
                                .or(old.class.as_deref())
                                .unwrap_or("the file")
                        )
                    })
                    .collect()
            })
            .unwrap_or_default();
        rows.push(json!({
            "path": path, "status": "ok", "score_now": now.defect.map(round), "band": now.band,
            "score_indexed": before.map(round), "change": change, "maintainability": now.maintainability.map(round),
            "hotspot": now.hotspot, "nloc": now.nloc, "findings": findings_of(&live), "resolved_since_index": fixed,
        }));
    }
    let summary = match (better, worse) {
        (0, 0) => format!("{} file(s) measured from disk now", rows.len()),
        _ => format!(
            "{} file(s) measured from disk now: {better} better, {worse} worse than when indexed",
            rows.len()
        ),
    };
    let mut envelope = Envelope::new("ok", summary).section("files", json!(rows));
    if paths.len() > MAX_TARGETS {
        envelope = envelope.truncated("files", paths.len(), "ask for the rest in another call");
    }
    envelope
}

fn finding(entry: &Entry, analysis: &Analysis, id: &str) -> Result<Envelope, RepositoryError> {
    let Some(file) = analysis
        .files
        .iter()
        .find(|f| f.findings.iter().any(|x| x.id == id))
    else {
        return Ok(Envelope::new("not_found", format!("no finding {id}; it may be fixed already or the file changed (call repo_health with the file as a target)")));
    };
    let prompt = entry.code_health_prompt(&file.path, Some(id))?;
    let place = file
        .findings
        .iter()
        .find(|x| x.id == id)
        .and_then(|x| x.function.clone().or_else(|| x.class.clone()));
    let mut envelope = Envelope::new("ok", format!("how to fix {id} in {}", file.path))
        .section("instructions", json!(prompt));
    if let Some(name) = place {
        envelope = envelope.next(next(
            "repo_symbol",
            json!({"target": format!("{}::{name}", file.path)}),
            "read the code it is about",
        ));
    }
    Ok(envelope.next(next(
        "repo_health",
        json!({"targets": [file.path]}),
        "after the edit, check the file is better",
    )))
}

pub fn run(entry: &Entry, arguments: Value) -> Result<Value, RepositoryError> {
    let args = Args::new(arguments, &KNOWN)?;
    let budget = args.budget();
    let limit = args.number("limit", 5, 1, 25);
    let analysis = entry.health_analysis()?;
    let paths = args.strings("targets");
    let envelope = if let Some(id) = args.string("finding") {
        finding(entry, &analysis, &id)?
    } else if !paths.is_empty() {
        targets(entry, &analysis, &paths)
    } else {
        dashboard(entry, &analysis, limit)?
    };
    Ok(envelope.ignored(args.ignored()).into_output(budget))
}
