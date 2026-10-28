//! `code_guidelines`: the project's own style and rules. `rules` says what applies to files before
//! they are edited (rules, limits, the style guide's sections); `check` reports violations in files
//! as they are on disk now, optionally only what the uncommitted change introduced.
use harness_guidelines::{Guidelines, Rule, RuleKind, Severity, Violation};
use serde_json::{json, Value};

use super::{
    super::{
        entry::Entry,
        error::RepositoryError,
        guidelines::{check_paths, load, CheckOptions, FileReport},
    },
    envelope::{next, Args, Envelope},
};

const KNOWN: [&str; 4] = ["mode", "targets", "changed_only", "budget"];
const MODES: [&str; 2] = ["rules", "check"];
const MAX_TARGETS: usize = 25;
const VIOLATIONS_PER_FILE: usize = 15;

const NOT_CONFIGURED: &str = "this repository has no code guidelines (.rusty/guidelines/rules.json or style.md), so only code health applies; follow the conventions of the surrounding code";

fn rule_json(rule: &Rule) -> Value {
    let mut out =
        json!({"id": rule.id, "kind": rule.kind.name(), "severity": rule.severity.name()});
    let object = out.as_object_mut().expect("an object");
    match &rule.kind {
        RuleKind::Prose { text } => {
            object.insert("text".into(), json!(text));
        }
        RuleKind::Pattern { regex, query, .. } => {
            object.insert("pattern".into(), json!(regex.as_ref().or(query.as_ref())));
        }
        RuleKind::Boundary { must_not_import } => {
            object.insert("must_not_import".into(), json!(must_not_import));
        }
        RuleKind::Metric { limits } => {
            object.insert("limits".into(), json!(limits));
        }
    }
    if let Some(message) = &rule.message {
        object.insert("message".into(), json!(message));
    }
    if let Some(fix) = &rule.fix {
        object.insert("fix".into(), json!(fix));
    }
    out
}

fn rules(guidelines: &Guidelines, paths: &[String]) -> Envelope {
    if paths.is_empty() {
        let all: Vec<Value> = guidelines.rules().map(rule_json).collect();
        let style: Vec<Value> = guidelines.style().sections().map(|s| json!(s)).collect();
        return Envelope::new(
            "ok",
            format!(
                "{} rule(s) and {} style section(s); pass targets for what applies to given files",
                all.len(),
                style.len()
            ),
        )
        .section("rules", json!(all))
        .section("style", json!(style));
    }
    let files: Vec<Value> = paths
        .iter()
        .take(MAX_TARGETS)
        .map(|path| {
            json!({
                "path": path,
                "limits": guidelines.limits_for(path),
                "rules": guidelines.rules_for(path).iter().map(|r| rule_json(r)).collect::<Vec<_>>(),
                "style": guidelines.style().for_path(path).iter().map(|s| s.text.clone()).collect::<Vec<_>>(),
            })
        })
        .collect();
    Envelope::new(
        "ok",
        format!(
            "the guidelines for {} file(s): follow them in every edit",
            files.len()
        ),
    )
    .section("files", json!(files))
    .next(next(
        "code_guidelines",
        json!({"mode": "check", "targets": paths, "changed_only": true}),
        "after editing, check what the change introduced",
    ))
}

fn violation_json(v: &Violation) -> Value {
    json!({
        "rule": v.rule,
        "severity": v.severity.name(),
        "lines": if v.start_line == v.end_line { v.start_line.to_string() } else { format!("{}-{}", v.start_line, v.end_line) },
        "in": v.function,
        "message": v.message,
        "fix": v.fix,
    })
}

fn check(entry: &Entry, guidelines: &Guidelines, paths: &[String], changed_only: bool) -> Envelope {
    let reports = check_paths(
        entry,
        guidelines,
        &paths[..paths.len().min(MAX_TARGETS)],
        CheckOptions { changed_only },
    );
    let count = |severity: Severity| -> usize {
        reports
            .iter()
            .flat_map(|r| &r.violations)
            .filter(|v| v.severity == severity)
            .count()
    };
    let (errors, warnings) = (count(Severity::Error), count(Severity::Warn));
    let files: Vec<Value> = reports.iter().map(file_json).collect();
    let scope = if changed_only {
        "introduced by the uncommitted change"
    } else {
        "in the files"
    };
    let summary = match (errors, warnings) {
        (0, 0) => format!("no guideline violations {scope}"),
        _ => format!(
            "{errors} error(s) and {warnings} warning(s) {scope}; fix every error before finishing"
        ),
    };
    let status = if errors > 0 { "violations" } else { "ok" };
    Envelope::new(status, summary)
        .section("errors", json!(errors))
        .section("warnings", json!(warnings))
        .section("files", json!(files))
}

fn file_json(report: &FileReport) -> Value {
    let mut out = json!({
        "path": report.path,
        "status": report.status,
        "violations": report.violations.iter().take(VIOLATIONS_PER_FILE).map(violation_json).collect::<Vec<_>>(),
    });
    if report.violations.len() > VIOLATIONS_PER_FILE {
        out["more"] = json!(report.violations.len() - VIOLATIONS_PER_FILE);
    }
    if report.boundaries_skipped {
        out["note"] = json!("boundary rules were skipped: the repository has no index yet");
    }
    out
}

pub fn run(entry: &Entry, arguments: Value) -> Result<Value, RepositoryError> {
    let mut args = Args::new(arguments, &KNOWN)?;
    let budget = args.budget();
    let paths = args.strings("targets");
    let mode = args
        .choices("mode", &MODES)
        .into_iter()
        .next()
        .unwrap_or_else(|| (if paths.is_empty() { "rules" } else { "check" }).to_owned());
    let changed_only = args.flag("changed_only");
    let loaded = load(entry.root());
    let envelope = if !loaded.present {
        Envelope::new("not_configured", NOT_CONFIGURED)
    } else {
        match &loaded.guidelines {
            Err(errors) => Envelope::new(
                "invalid",
                "the guidelines file has mistakes, so no rule was checked; tell the user",
            )
            .section("errors", json!(errors)),
            Ok(guidelines) if mode == "rules" => rules(guidelines, &paths),
            Ok(_) if paths.is_empty() => {
                Envelope::new("invalid", "check needs targets: the files to check")
            }
            Ok(guidelines) => check(entry, guidelines, &paths, changed_only),
        }
    };
    Ok(envelope.ignored(args.ignored()).into_output(budget))
}
