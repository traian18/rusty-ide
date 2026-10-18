//! The text behind "Copy fix prompt": one file, or one finding in it, written for a coding agent.
//!
//! Every prompt has the same parts so an agent can act without asking back: role, target,
//! current state (facts from the indexes), tasks, constraints, expected output, and a footer
//! naming the snapshot so a stale prompt is recognisable. It carries facts and line numbers,
//! never file contents.
use std::fmt::Write as _;

use super::{
    super::{
        entry::Entry,
        error::RepositoryError,
        health::{
            model::ScoredFinding,
            prompt::{checklist, issue as health_issue},
        },
    },
    model::{FileDetail, FileFinding},
};

/// Longest prompt, in characters.
const MAX_CHARS: usize = 20_000;

fn lines_text(lines: &[u32]) -> String {
    if lines.is_empty() {
        return String::new();
    }
    let list: Vec<String> = lines.iter().take(12).map(u32::to_string).collect();
    format!(" (line {})", list.join(", "))
}

fn state(out: &mut String, detail: &FileDetail) {
    let row = &detail.row;
    let _ = writeln!(out, "## Current state");
    let _ = writeln!(
        out,
        "- `{}` is a {} file of {} lines{}.",
        row.path,
        row.language,
        row.lines,
        row.package
            .as_ref()
            .map(|p| format!(" in package `{p}`"))
            .unwrap_or_default()
    );
    let _ = writeln!(
        out,
        "- Imported by {} files; {} files reach it within two hops. It imports {} files.",
        row.importers, detail.blast_radius, row.imports
    );
    if !detail.importers.is_empty() {
        let names: Vec<String> = detail
            .importers
            .iter()
            .map(|n| format!("`{}`", n.path))
            .collect();
        let _ = writeln!(out, "- Importers: {}.", names.join(", "));
    }
    if row.commits > 0 {
        let owner = match (&row.owner, row.owner_share) {
            (Some(name), Some(share)) => {
                format!("; main author {name} ({:.0}% of commits)", share * 100.0)
            }
            _ => String::new(),
        };
        let _ = writeln!(
            out,
            "- Changed in {} commits by {} people{owner}.",
            row.commits, row.contributors
        );
    }
    if !detail.co_changed.is_empty() {
        let names: Vec<String> = detail
            .co_changed
            .iter()
            .take(5)
            .map(|c| format!("`{}` ({} times)", c.path, c.commits))
            .collect();
        let _ = writeln!(
            out,
            "- Usually changes together with: {}.",
            names.join(", ")
        );
    }
    let _ = writeln!(out);
}

fn issue(out: &mut String, finding: &FileFinding, path: &str) {
    let _ = writeln!(out, "### {}{}", finding.title, lines_text(&finding.lines));
    let _ = writeln!(
        out,
        "- Rule: `{}`, severity {}, confidence {}{}.",
        finding.rule,
        finding.severity,
        finding.confidence,
        if finding.candidate {
            ", a heuristic candidate"
        } else {
            ""
        }
    );
    let _ = writeln!(out, "- What was found: {}", finding.summary);
    let _ = writeln!(out, "- Why it matters: {}", finding.rationale);
    if !finding.other_files.is_empty() {
        let names: Vec<String> = finding
            .other_files
            .iter()
            .map(|f| format!("`{f}`"))
            .collect();
        let _ = writeln!(out, "- Also involves: {}.", names.join(", "));
    }
    if let Some(note) = &finding.interpretation {
        let _ = writeln!(out, "- Caveat: {note} Confirm before changing `{path}`.");
    }
    let _ = writeln!(out);
}

/// The prompt for `detail`, or for one of its findings. `health` is the file's code health issues,
/// costliest first; they are included when the prompt is for the whole file.
pub fn build(
    detail: &FileDetail,
    finding: Option<&FileFinding>,
    health: &[ScoredFinding],
    snapshot: &str,
) -> String {
    let path = &detail.row.path;
    let mut out = String::new();
    let _ = writeln!(out, "You are working in this repository as a careful senior engineer. Fix the issue below with the smallest change that removes it, keeping behaviour the same.\n");
    let _ = writeln!(out, "## Target");
    match finding {
        Some(f) => {
            let _ = writeln!(out, "`{path}`{}: {}\n", lines_text(&f.lines), f.title);
        }
        None => {
            let _ = writeln!(
                out,
                "`{path}`: every issue the repository index reports for this file.\n"
            );
        }
    }
    state(&mut out, detail);
    let _ = writeln!(out, "## Issues");
    let issues: Vec<&FileFinding> = match finding {
        Some(f) => vec![f],
        None => detail.findings.iter().collect(),
    };
    let health: Vec<&ScoredFinding> = if finding.is_some() {
        Vec::new()
    } else {
        health.iter().collect()
    };
    if issues.is_empty() && health.is_empty() {
        let _ = writeln!(out, "The index reports no findings for this file. Review it for the risks the state above suggests (size, how many files depend on it, how often it changes) and say what, if anything, is worth changing.\n");
    }
    for f in &issues {
        issue(&mut out, f, path);
    }
    if !health.is_empty() {
        let _ = writeln!(out, "## Code health issues");
        checklist(&mut out, &health);
        for f in &health {
            health_issue(&mut out, f);
        }
    }
    let _ = writeln!(out, "## Tasks");
    if issues.len() + health.len() > 1 {
        let _ = writeln!(
            out,
            "1. Decide which of these issues share a root cause, and fix that cause first."
        );
    } else {
        let _ = writeln!(out, "1. Confirm the issue in the code at the lines given; if it is not real, stop and say why.");
    }
    let _ = writeln!(out, "2. Before moving or changing anything others depend on, call `repo_context` with mode `blast_radius` on `{path}` and list the files that must change with it.");
    let _ = writeln!(
        out,
        "3. Make the change, updating every importer and test affected."
    );
    let _ = writeln!(
        out,
        "4. Build and run the tests that cover the files you changed.\n"
    );
    let _ = writeln!(out, "## Constraints");
    let _ = writeln!(out, "- Keep public behaviour and interfaces unless the issue requires changing them; if it does, update every caller.");
    let _ = writeln!(
        out,
        "- Change only what the fix needs; no unrelated refactoring or formatting."
    );
    let _ = writeln!(
        out,
        "- Candidate findings are heuristics: verify before deleting or moving code.\n"
    );
    let _ = writeln!(out, "## Expected output");
    let _ = writeln!(out, "The changed files, a short explanation of the cause and the fix, and the build and test results.\n");
    let _ = writeln!(out, "---\nFrom the repository index, snapshot {}. If the code has changed since, re-check the facts above first.", snapshot.chars().take(12).collect::<String>());
    if out.chars().count() > MAX_CHARS {
        out = out.chars().take(MAX_CHARS).collect::<String>() + "\n…(shortened)";
    }
    out
}

impl Entry {
    /// "Copy fix prompt" for a file, or for one finding in it.
    pub fn dashboard_prompt(
        &self,
        file: &str,
        finding: Option<&str>,
    ) -> Result<String, RepositoryError> {
        let detail = self.dashboard_file(file)?;
        let chosen = match finding {
            Some(id) => Some(detail.findings.iter().find(|f| f.id == id).ok_or_else(|| {
                RepositoryError::new("not_found", format!("{id} is not a finding of {file}"))
            })?),
            None => None,
        };
        // Files code health does not measure simply have no health issues to add.
        let health = match chosen {
            Some(_) => Vec::new(),
            None => self
                .code_health_file(file)
                .map(|d| d.findings)
                .unwrap_or_default(),
        };
        Ok(build(&detail, chosen, &health, &self.snapshot()?.id.0))
    }
}
