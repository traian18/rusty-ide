//! Files on disk through the repository's guidelines: measured live, with their imports from the
//! index when there is one, and optionally only what the uncommitted change introduced.
use harness_code_analysis::metrics::{language_of, measure_file};
use harness_guidelines::{
    check_file, retain_introduced, FileInput, Guidelines, Import, Kinds, Violation,
};
use harness_workspace::{import_graph::Resolution, repository_intelligence::RepositorySnapshot};

use super::{super::entry::Entry, changed_lines};

/// Largest file checked.
const MAX_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Default)]
pub(in crate::repository) struct CheckOptions {
    /// Only what the change since the last commit introduced.
    pub changed_only: bool,
}

pub(in crate::repository) struct FileReport {
    pub path: String,
    /// `ok`, `not_found` or `too_large`.
    pub status: &'static str,
    pub violations: Vec<Violation>,
    /// Boundary rules could not run: the repository has no index yet.
    pub boundaries_skipped: bool,
}

fn line_of(source: &str, byte: usize) -> u32 {
    let end = byte.min(source.len());
    source.as_bytes()[..end]
        .iter()
        .filter(|b| **b == b'\n')
        .count() as u32
        + 1
}

/// What `path` imports inside the repository, by the index (which may predate the last edit).
fn imports_of(snapshot: &RepositorySnapshot, path: &str, source: &str) -> Vec<Import> {
    snapshot
        .imports
        .edges
        .iter()
        .filter(|edge| edge.fact.importing_file.as_path().to_string_lossy() == path)
        .filter_map(|edge| match &edge.resolution {
            Resolution::ResolvedInternal { target_file, .. } => Some(Import {
                target: target_file.as_path().to_string_lossy().replace('\\', "/"),
                line: line_of(source, edge.fact.span.start),
            }),
            _ => None,
        })
        .collect()
}

pub(in crate::repository) fn check_paths(
    entry: &Entry,
    guidelines: &Guidelines,
    paths: &[String],
    options: CheckOptions,
) -> Vec<FileReport> {
    let snapshot = entry.snapshot().ok();
    paths
        .iter()
        .map(|path| {
            let full = entry.root().join(path);
            let report = |status, violations| FileReport {
                path: path.clone(),
                status,
                violations,
                boundaries_skipped: snapshot.is_none(),
            };
            let Ok(meta) = std::fs::metadata(&full) else {
                return report("not_found", Vec::new());
            };
            if !meta.is_file() {
                return report("not_found", Vec::new());
            }
            if meta.len() > MAX_BYTES {
                return report("too_large", Vec::new());
            }
            let Ok(source) = std::fs::read_to_string(&full) else {
                return report("not_found", Vec::new());
            };
            let metrics =
                language_of(path).and_then(|id| measure_file(&id, path, source.as_bytes()).ok());
            let imports = snapshot.as_ref().map(|s| imports_of(s, path, &source));
            let input = FileInput {
                path,
                source: &source,
                metrics: metrics.as_ref(),
                imports: imports.as_deref(),
            };
            let mut violations = check_file(guidelines, &input, Kinds::ALL);
            if options.changed_only {
                if let Some(changed) = changed_lines(entry.root(), path) {
                    violations = retain_introduced(violations, &changed);
                }
            }
            report("ok", violations)
        })
        .collect()
}
