//! Saved analysis and background work: a repository analysed once opens without a scan, changed
//! files are remembered and re-measured, jobs are announced and can be stopped.
use std::sync::{Arc, Mutex};

use super::{commit_history, write, write_fixture, Entry};
use crate::repository::{
    jobs::{JobKind, JobState, Notice},
    registry::RepositoryState,
    storage::{repository_dir, Storage},
};

fn configured(data: &std::path::Path) -> (RepositoryState, Arc<Mutex<Vec<String>>>) {
    let state = RepositoryState::new();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let log = seen.clone();
    state.set_background(false);
    state.configure(
        data.to_path_buf(),
        Arc::new(move |notice| {
            if let Notice::AnalysisUpdated(root) = notice {
                log.lock().unwrap().push(root);
            }
        }),
    );
    (state, seen)
}

#[tokio::test]
async fn an_analysed_repository_reopens_from_disk_without_a_scan() {
    let dir = tempfile::tempdir().unwrap();
    write_fixture(dir.path());
    commit_history(dir.path());
    let data = tempfile::tempdir().unwrap();
    let storage = repository_dir(data.path(), &std::fs::canonicalize(dir.path()).unwrap());
    {
        let entry = Entry::open(dir.path(), Some(&storage)).unwrap();
        assert!(entry.open_response().snapshot.is_none());
        entry.refresh(true).await.unwrap();
        entry.code_health().unwrap();
        entry
            .health
            .save(&Storage::new(storage.clone()).health_path());
    }
    let again = Entry::open(dir.path(), Some(&storage)).unwrap();
    let open = again.open_response();
    assert!(open.snapshot.is_some(), "loaded, not scanned");
    assert!(open.git.is_some());
    assert!(open.built_at_ms.is_some());
    let report = again.code_health().unwrap();
    assert!(report
        .files
        .iter()
        .any(|f| f.path == "src/a.rs" && f.defect.is_some()));
}

#[tokio::test]
async fn an_analysis_job_records_progress_clears_pending_work_and_announces_itself() {
    let dir = tempfile::tempdir().unwrap();
    write_fixture(dir.path());
    commit_history(dir.path());
    let data = tempfile::tempdir().unwrap();
    let (state, seen) = configured(data.path());
    let root = dir.path().to_string_lossy().to_string();
    let entry = state.entry(&root).unwrap();
    let storage = entry.storage.as_ref().unwrap();
    assert!(
        storage.pending().full_analysis,
        "never analysed: a full analysis is owed"
    );

    state.run_analysis(entry.clone()).await.unwrap();
    assert!(entry.graph.current().is_some());
    assert!(storage.pending().is_empty());
    let jobs = state.jobs().list();
    assert_eq!(
        (jobs[0].kind, jobs[0].state),
        (JobKind::Analysis, JobState::Finished)
    );
    assert!(jobs[0].label.starts_with("Analysing "));
    assert_eq!(seen.lock().unwrap().len(), 1);

    // A change is remembered (and would be analysed after a quiet period if enabled).
    write(
        dir.path(),
        "src/c.rs",
        "use crate::a::A;\npub fn more() {}\n",
    );
    let canonical = std::fs::canonicalize(dir.path()).unwrap();
    state.files_changed(&[canonical.join("src/c.rs"), canonical.join(".git/index")]);
    assert_eq!(
        storage
            .pending()
            .changed_files
            .into_iter()
            .collect::<Vec<_>>(),
        ["src/c.rs"]
    );
    state.run_analysis(entry.clone()).await.unwrap();
    assert!(state
        .jobs()
        .list()
        .iter()
        .any(|j| j.label.contains("1 changed files")));
    assert!(storage.pending().changed_files.is_empty());
    assert!(entry
        .code_health()
        .unwrap()
        .files
        .iter()
        .any(|f| f.path == "src/c.rs"));
}

#[tokio::test]
async fn documentation_work_is_queued_and_survives_a_restart() {
    let dir = tempfile::tempdir().unwrap();
    write_fixture(dir.path());
    let data = tempfile::tempdir().unwrap();
    let (state, _) = configured(data.path());
    let root = dir.path().to_string_lossy().to_string();
    let entry = state.entry(&root).unwrap();
    entry.storage.as_ref().unwrap().update_pending(|p| {
        p.documentation = vec!["written:overview".into(), "folder:dir:src".into()];
        p.documentation_model = Some("m1".into());
    });
    drop(entry);
    let (restarted, _) = configured(data.path());
    let entry = restarted.entry(&root).unwrap();
    let pending = entry.storage.as_ref().unwrap().pending();
    assert_eq!(
        pending.documentation,
        ["written:overview", "folder:dir:src"]
    );
    assert_eq!(pending.documentation_model.as_deref(), Some("m1"));
}

#[test]
fn the_files_a_commit_changed_point_at_the_pages_built_from_them() {
    let dir = tempfile::tempdir().unwrap();
    write_fixture(dir.path());
    commit_history(dir.path());
    let (commit, files) = crate::repository::written::files_in_head(dir.path()).unwrap();
    assert_eq!(commit.len(), 40);
    assert_eq!(files, ["src/a.rs", "src/b.rs"]);
}
