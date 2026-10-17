//! Condensing core snapshots into the summaries the UI shows next to the canvas.
use std::collections::BTreeSet;

use harness_findings::FindingSet;
use harness_git_analysis::GitSnapshot;
use harness_workspace::repository_intelligence::RepositorySnapshot;

use super::dto::{FindingsStatus, FrameworksSummary, GitSummary, SnapshotSummary};

/// Diagnostics sent to the UI; `diagnostics_total` reports how many exist.
const MAX_DIAGNOSTICS: usize = 200;

pub fn snapshot_summary(snapshot: &RepositorySnapshot) -> SnapshotSummary {
    let languages = snapshot
        .imports
        .files
        .iter()
        .map(|file| format!("{:?}", file.profile).to_lowercase())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let diagnostics = snapshot
        .graph
        .diagnostics
        .iter()
        .chain(&snapshot.imports.diagnostics)
        .cloned()
        .collect::<Vec<_>>();
    SnapshotSummary {
        id: snapshot.id.0.clone(),
        packages: snapshot.graph.packages.len(),
        files: snapshot.imports.files.len(),
        imports: snapshot.imports.edges.len(),
        partial: snapshot.imports.partial,
        languages,
        groups_configured: snapshot.groups.configured,
        group_count: snapshot.groups.groups.len(),
        unattached_files: snapshot.imports.unattached.len(),
        diagnostics_total: diagnostics.len(),
        diagnostics: diagnostics.into_iter().take(MAX_DIAGNOSTICS).collect(),
        frameworks: FrameworksSummary {
            configured: snapshot.frameworks.configured,
            applications: snapshot.frameworks.applications.clone(),
            relations: snapshot.frameworks.relations.len(),
            partial: snapshot.frameworks.partial,
            diagnostics_total: snapshot.frameworks.diagnostics.len(),
            diagnostics: snapshot
                .frameworks
                .diagnostics
                .iter()
                .take(MAX_DIAGNOSTICS)
                .cloned()
                .collect(),
        },
    }
}

pub fn git_summary(snapshot: &GitSnapshot) -> GitSummary {
    GitSummary {
        id: snapshot.id.0.clone(),
        head: snapshot.head.0.clone(),
        commits_used: snapshot.coverage.commits_used,
        shallow: snapshot.coverage.shallow,
        working_tree_dirty: snapshot.coverage.working_tree_dirty,
        walk_stop: format!("{:?}", snapshot.coverage.walk_stop).to_lowercase(),
        interpretation: snapshot.coverage.interpretation.clone(),
    }
}

pub fn findings_status(set: &FindingSet) -> FindingsStatus {
    FindingsStatus {
        id: set.id.0.clone(),
        summary: set.summary.clone(),
    }
}
