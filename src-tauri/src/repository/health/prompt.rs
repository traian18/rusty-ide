//! "Copy fix prompt" for code health: a file, or one of its findings, as instructions for a coding
//! agent. Facts and line numbers only, never file contents; the same parts as every other prompt
//! (role, target, state, issues, tasks, constraints, expected output, snapshot footer).
use std::fmt::Write as _;

use harness_code_health::registry;

use super::{
    super::{entry::Entry, error::RepositoryError},
    model::{HealthFileDetail, ScoredFinding},
    remedy::how_to_fix,
};

const MAX_CHARS: usize = 20_000;

/// One issue with everything an agent needs to fix it without opening the page: where, what was
/// measured against which limit, what the check means, and how to fix that kind of issue.
pub(in crate::repository) fn issue(out: &mut String, f: &ScoredFinding) {
    let finding = &f.finding;
    let place = match (&finding.function, &finding.class) {
        (Some(function), _) => format!(" in `{function}`"),
        (None, Some(class)) => format!(" in `{class}`"),
        _ => String::new(),
    };
    let lines = if finding.start_line == finding.end_line {
        format!("line {}", finding.start_line)
    } else {
        format!("lines {}-{}", finding.start_line, finding.end_line)
    };
    let _ = writeln!(
        out,
        "### {}{place} ({lines})",
        finding.detector.replace('_', " "),
    );
    let _ = writeln!(out, "- Location: `{}` {lines}{place}.", finding.path);
    let _ = writeln!(
        out,
        "- Severity {:?}; fixing it is worth {:.2} points of code health.",
        finding.severity, f.impact
    );
    let _ = writeln!(out, "- Problem: {}", finding.reason);
    if !finding.measured.is_empty() {
        let measured: Vec<String> = finding
            .measured
            .iter()
            .map(|(k, v)| format!("{} {v}", k.replace('_', " ")))
            .collect();
        let _ = writeln!(out, "- Measured: {}.", measured.join(", "));
    }
    if let Some(detector) = registry().iter().find(|d| d.id() == finding.detector) {
        let _ = writeln!(out, "- What this check looks for: {}", detector.summary());
    }
    let _ = writeln!(out, "- How to fix: {}", how_to_fix(&finding.detector));
    let _ = writeln!(
        out,
        "- Done when: the code at this location no longer shows the problem above (the measured values fall below their limits) and behaviour is unchanged."
    );
    let _ = writeln!(out);
}

/// A numbered list of the issues before their details, so nothing is missed.
pub(in crate::repository) fn checklist(out: &mut String, issues: &[&ScoredFinding]) {
    if issues.len() < 2 {
        return;
    }
    let _ = writeln!(out, "Fix all {} issues:", issues.len());
    for (n, f) in issues.iter().enumerate() {
        let finding = &f.finding;
        let at = finding
            .function
            .as_ref()
            .or(finding.class.as_ref())
            .map(|name| format!("`{name}`, "))
            .unwrap_or_default();
        let _ = writeln!(
            out,
            "{}. {} ({at}line {}): {}",
            n + 1,
            finding.detector.replace('_', " "),
            finding.start_line,
            finding.reason
        );
    }
    let _ = writeln!(out);
}

pub(super) fn build(
    detail: &HealthFileDetail,
    finding: Option<&ScoredFinding>,
    snapshot: &str,
) -> String {
    let row = &detail.row;
    let mut out = String::new();
    let _ = writeln!(out, "You are working in this repository as a careful senior engineer. Improve the code health of the file below with the smallest changes that remove the issues, keeping behaviour the same.\n");
    let _ = writeln!(out, "## Target");
    match finding {
        Some(f) => {
            let _ = writeln!(
                out,
                "`{}`: the {} issue below.\n",
                row.path,
                f.finding.detector.replace('_', " ")
            );
        }
        None => {
            let _ = writeln!(
                out,
                "`{}`: every issue code health reports for it.\n",
                row.path
            );
        }
    }
    let _ = writeln!(out, "## Current state");
    if let Some(score) = row.defect {
        let _ = writeln!(
            out,
            "- Code health {score:.1} of 10 (target {:.1}); maintainability {:.1}.",
            detail.target,
            row.maintainability.unwrap_or(score)
        );
        let _ = writeln!(
            out,
            "- The code itself costs {:.2} points, its change history {:.2}.",
            row.structure, row.history
        );
    }
    let _ = writeln!(
        out,
        "- {} lines of {} code, imported by {} files{}.",
        row.nloc,
        row.language,
        detail.importers,
        if row.hotspot {
            "; a hotspot (changes often and recently)"
        } else {
            ""
        }
    );
    if let Some(top) = detail.functions.first() {
        let _ = writeln!(
            out,
            "- Most complex function: `{}` (lines {}-{}, CCN {}, nesting {}, {} lines).",
            top.name, top.start_line, top.end_line, top.ccn, top.max_nesting, top.nloc
        );
    }
    let _ = writeln!(out, "\n## Issues");
    let issues: Vec<&ScoredFinding> = match finding {
        Some(f) => vec![f],
        None => detail.findings.iter().collect(),
    };
    if issues.is_empty() {
        let _ = writeln!(out, "Code health reports no issues for this file.\n");
    }
    checklist(&mut out, &issues);
    for f in &issues {
        issue(&mut out, f);
    }
    let _ = writeln!(out, "## Tasks");
    if issues.len() > 1 {
        let _ = writeln!(
            out,
            "1. Decide which issues share a cause and fix that cause first, most costly first."
        );
    } else {
        let _ = writeln!(
            out,
            "1. Confirm the issue at the lines given; if it is not real, stop and say why."
        );
    }
    let _ = writeln!(out, "2. Before moving or splitting code others depend on, call `repo_context` with mode `blast_radius` on `{}` and list what must change with it.", row.path);
    let _ = writeln!(out, "3. Refactor: extract functions, flatten nesting with early returns, name complex conditions, split types by responsibility, as the issue asks.");
    let _ = writeln!(
        out,
        "4. Build and run the tests that cover the changed files.\n"
    );
    let _ = writeln!(out, "## Constraints");
    let _ = writeln!(
        out,
        "- Keep behaviour and public interfaces; if an interface must change, update every caller."
    );
    let _ = writeln!(out, "- History issues (churn, ownership, fixes) are not fixed by editing alone: say what in the code makes this file change so often and address that.");
    let _ = writeln!(out, "- No unrelated changes.\n");
    let _ = writeln!(out, "## Expected output");
    let _ = writeln!(
        out,
        "The changed files, what each change fixes, and the build and test results.\n"
    );
    let _ = writeln!(out, "---\nFrom the code health index, snapshot {}. If the code has changed since, re-check the facts above first.", snapshot.chars().take(12).collect::<String>());
    if out.chars().count() > MAX_CHARS {
        out = out.chars().take(MAX_CHARS).collect::<String>() + "\n…(shortened)";
    }
    out
}

impl Entry {
    pub fn code_health_prompt(
        &self,
        path: &str,
        finding: Option<&str>,
    ) -> Result<String, RepositoryError> {
        let detail = self.code_health_file(path)?;
        let chosen = match finding {
            Some(id) => Some(
                detail
                    .findings
                    .iter()
                    .find(|f| f.finding.id == id)
                    .ok_or_else(|| {
                        RepositoryError::new(
                            "not_found",
                            format!("{id} is not a finding of {path}"),
                        )
                    })?,
            ),
            None => None,
        };
        Ok(build(&detail, chosen, &self.health_analysis()?.snapshot))
    }
}
