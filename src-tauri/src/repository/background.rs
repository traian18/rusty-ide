//! Analysis that runs by itself, off the UI: once when a repository has never been analysed, again
//! a few seconds after its files change (only the changed files are re-measured for code health),
//! and on start for work an earlier run left unfinished. Each run is a job in the process bubble
//! and can be stopped from there; what it builds is saved, so the next start does not repeat it.
use std::{
    path::{Path, PathBuf},
    sync::{atomic::Ordering, Arc},
    time::Duration,
};

use super::{
    entry::Entry,
    error::RepositoryError,
    jobs::{JobKind, JobState, Notice},
    registry::RepositoryState,
};

/// Quiet time after the last change before an analysis starts.
pub const QUIET: Duration = Duration::from_secs(5);
/// Folders whose changes never matter to the analysis.
const IGNORED: [&str; 8] = [
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".venv",
    "__pycache__",
];

fn name_of(root: &Path) -> String {
    root.file_name().map_or_else(
        || root.display().to_string(),
        |n| n.to_string_lossy().into_owned(),
    )
}

impl RepositoryState {
    /// The repository-relative paths in `paths` that belong to `root` and matter.
    fn relevant(root: &Path, paths: &[PathBuf]) -> Vec<String> {
        paths
            .iter()
            .filter_map(|p| p.strip_prefix(root).ok())
            .filter(|rel| {
                !rel.components()
                    .any(|c| c.as_os_str().to_str().is_some_and(|n| IGNORED.contains(&n)))
            })
            .map(|rel| rel.to_string_lossy().replace('\\', "/"))
            .filter(|rel| !rel.is_empty())
            .collect()
    }

    /// Files changed on disk: remembered for every loaded repository they belong to, and an analysis
    /// scheduled after a quiet period.
    pub fn files_changed(&self, paths: &[PathBuf]) {
        for entry in self.loaded_entries() {
            let changed = Self::relevant(entry.root(), paths);
            if changed.is_empty() {
                continue;
            }
            if let Some(storage) = &entry.storage {
                storage.update_pending(|p| p.changed_files.extend(changed));
            }
            if self.background_enabled() {
                self.schedule_analysis(entry, QUIET);
            }
        }
    }

    /// Starts an analysis after `delay`, unless another change comes first (then it waits again).
    pub fn schedule_analysis(&self, entry: Arc<Entry>, delay: Duration) {
        let generation = entry.schedule.fetch_add(1, Ordering::SeqCst) + 1;
        let state = self.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(delay).await;
            if entry.schedule.load(Ordering::SeqCst) != generation {
                return;
            }
            if let Err(error) = state.run_analysis(entry).await {
                eprintln!(
                    "Rust [repository background] analysis failed: {}",
                    error.message
                );
            }
        });
    }

    /// What a repository needs on first load: a first analysis, or the work left from last time.
    pub(super) fn resume(&self, entry: &Arc<Entry>) {
        let Some(storage) = &entry.storage else {
            return;
        };
        let mut pending = storage.pending();
        if entry.graph.current().is_none() && !pending.full_analysis {
            pending = storage.update_pending(|p| p.full_analysis = true);
        }
        if pending.needs_analysis() && self.background_enabled() {
            self.schedule_analysis(entry.clone(), Duration::ZERO);
        } else if entry.graph.current().is_some() {
            let entry = entry.clone();
            tauri::async_runtime::spawn(async move { entry.restore_findings().await });
        }
    }

    /// One analysis, as a job: rebuild the index (and Git history and findings), then code health
    /// for the files that changed, then save. Stopping the job stops the rebuild; unfinished work
    /// stays listed for next time.
    pub async fn run_analysis(&self, entry: Arc<Entry>) -> Result<(), RepositoryError> {
        let root = entry.root().display().to_string();
        if self.jobs().running(JobKind::Analysis, &root) {
            // The running one will be followed by another: changes keep being recorded.
            self.schedule_analysis(entry, QUIET);
            return Ok(());
        }
        let pending = entry
            .storage
            .as_ref()
            .map(|s| s.pending())
            .unwrap_or_default();
        let first = entry.graph.current().is_none();
        let label = if first {
            format!("Analysing {}", name_of(entry.root()))
        } else if pending.changed_files.is_empty() {
            format!("Updating {}", name_of(entry.root()))
        } else {
            format!(
                "Updating {} ({} changed files)",
                name_of(entry.root()),
                pending.changed_files.len()
            )
        };
        let (id, token) = self.jobs().start(JobKind::Analysis, &root, &label);
        let stopper = {
            let entry = entry.clone();
            let token = token.clone();
            tauri::async_runtime::spawn(async move {
                token.cancelled().await;
                entry.cancel_refresh();
            })
        };
        self.jobs().progress(
            id,
            Some(0),
            Some(2),
            Some("Reading the code and its history"),
        );
        let refreshed = entry.refresh(true).await;
        if token.is_cancelled() {
            stopper.abort();
            return Ok(());
        }
        if let Err(error) = refreshed {
            stopper.abort();
            self.jobs()
                .finish(id, JobState::Failed, Some(&error.message));
            return Err(error);
        }
        self.jobs()
            .progress(id, Some(1), Some(2), Some("Checking code health"));
        entry.health.invalidate();
        let worker = entry.clone();
        let health =
            tauri::async_runtime::spawn_blocking(move || worker.health_analysis().map(|_| ()))
                .await;
        stopper.abort();
        if token.is_cancelled() {
            return Ok(());
        }
        match health {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                self.jobs()
                    .finish(id, JobState::Failed, Some(&error.message));
                return Err(error);
            }
            Err(error) => {
                self.jobs()
                    .finish(id, JobState::Failed, Some(&error.to_string()));
                return Err(RepositoryError::new("internal", error.to_string()));
            }
        }
        if let Some(storage) = &entry.storage {
            entry.health.save(&storage.health_path());
            storage.update_pending(|p| {
                p.full_analysis = false;
                for file in &pending.changed_files {
                    p.changed_files.remove(file);
                }
            });
        }
        self.jobs().finish(id, JobState::Finished, None);
        self.jobs().tell(Notice::AnalysisUpdated(root));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_paths_inside_the_root_and_outside_ignored_folders_count() {
        let root = Path::new("/ws/app");
        let paths = vec![
            PathBuf::from("/ws/app/src/a.rs"),
            PathBuf::from("/ws/app/.git/index"),
            PathBuf::from("/ws/app/web/node_modules/x/index.js"),
            PathBuf::from("/ws/other/b.rs"),
            PathBuf::from("/ws/app"),
        ];
        assert_eq!(RepositoryState::relevant(root, &paths), ["src/a.rs"]);
    }
}
