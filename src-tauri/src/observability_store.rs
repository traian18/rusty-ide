//! Append-only JSONL execution history under `<workspace>/.rusty/observability/` (last snapshot per id wins).
//!
//! This file decides where each stream's lines go and serves the commands;
//! `jsonl` owns the files themselves and `records` what the lines mean
//! (ids, days, tombstones). A new day-partitioned stream is a `DayStream`.

mod jsonl;
mod records;

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::fs;
use tokio::sync::Mutex;

use jsonl::{append_lines, dir_bytes, ensure_dir, ensure_gitignore, read_jsonl};
use records::{
    day_of, fold, id_of, is_tombstone, newest_first, run_entries_path, session_of, today,
    tombstone, valid_run_id, Tombstones,
};

const DIR: &str = "observability";
const TOMBSTONES: &str = "tombstones.jsonl";
const INDEX: &str = "index.jsonl";

#[derive(Default)]
pub struct ObservabilityState {
    lock: Mutex<()>,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Stream {
    Executions,
    TrajectoryIndex,
    TrajectoryEntries,
    Diagnostics,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum DeleteScope {
    All,
    Execution { id: String },
    Session { id: String },
    Run { id: String },
}

#[derive(Debug, Serialize, Default)]
pub struct LoadResult {
    pub executions: Vec<Value>,
    pub trajectories: Vec<Value>,
    pub bytes: u64,
}

/// A stream stored as one JSONL file per day, by a date field of each record.
struct DayStream {
    dir: &'static str,
    day_field: &'static str,
    missing_id: &'static str,
}

const EXECUTIONS: DayStream = DayStream {
    dir: "executions",
    day_field: "requestedAt",
    missing_id: "execution record is missing an id",
};

const DIAGNOSTICS: DayStream = DayStream {
    dir: "diagnostics",
    day_field: "timestamp",
    missing_id: "diagnostic record is missing an id",
};

/// Runs: an index of run snapshots plus one entries file per run.
const TRAJECTORIES: &str = "trajectories";

fn to_strings(lines: &[Value]) -> Vec<String> {
    lines.iter().map(Value::to_string).collect()
}

async fn append_by_day(base: &Path, stream: &DayStream, lines: Vec<Value>) -> Result<(), String> {
    let dir = base.join(stream.dir);
    ensure_dir(&dir).await?;
    let mut by_day: HashMap<String, Vec<String>> = HashMap::new();
    for line in lines {
        if id_of(&line).is_none() {
            return Err(stream.missing_id.into());
        }
        let day = day_of(&line, stream.day_field).unwrap_or_else(today);
        by_day.entry(day).or_default().push(line.to_string());
    }
    for (day, day_lines) in by_day {
        append_lines(&dir.join(format!("{day}.jsonl")), &day_lines).await?;
    }
    Ok(())
}

async fn append_trajectory_index(base: &Path, lines: &[Value]) -> Result<(), String> {
    let dir = base.join(TRAJECTORIES);
    ensure_dir(&dir).await?;
    if lines
        .iter()
        .any(|l| id_of(l).is_none_or(|id| !valid_run_id(id)))
    {
        return Err("trajectory index line has an invalid id".into());
    }
    append_lines(&dir.join(INDEX), &to_strings(lines)).await
}

async fn append_trajectory_entries(
    base: &Path,
    run_id: Option<String>,
    lines: &[Value],
) -> Result<(), String> {
    let dir = base.join(TRAJECTORIES);
    let path = run_id
        .and_then(|id| run_entries_path(&dir, &id))
        .ok_or("invalid or missing run id")?;
    ensure_dir(&dir).await?;
    append_lines(&path, &to_strings(lines)).await
}

pub async fn append_at(
    state: &ObservabilityState,
    root: &Path,
    stream: Stream,
    run_id: Option<String>,
    lines: Vec<Value>,
) -> Result<(), String> {
    let _guard = state.lock.lock().await;
    let base = root.join(DIR);
    ensure_dir(&base).await?;
    ensure_gitignore(&base).await;
    match stream {
        Stream::Executions => append_by_day(&base, &EXECUTIONS, lines).await,
        Stream::Diagnostics => append_by_day(&base, &DIAGNOSTICS, lines).await,
        Stream::TrajectoryIndex => append_trajectory_index(&base, &lines).await,
        Stream::TrajectoryEntries => append_trajectory_entries(&base, run_id, &lines).await,
    }
}

/// A day file's day, when it is one to load: not the tombstones file, and at or after `since`.
fn wanted_day(file_name: &str, since: Option<&str>) -> Option<String> {
    let day = file_name.strip_suffix(".jsonl")?;
    let wanted = day != "tombstones" && since.is_none_or(|since| day >= since);
    wanted.then(|| day.to_string())
}

/// The days to load, oldest first; none when nothing is to be loaded.
async fn day_files(dir: &Path, since: Option<&str>, limit: usize) -> Vec<String> {
    if limit == 0 {
        return Vec::new();
    }
    let Ok(mut entries) = fs::read_dir(dir).await else {
        return Vec::new();
    };
    let mut days = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        if let Some(day) = wanted_day(&entry.file_name().to_string_lossy(), since) {
            days.push(day);
        }
    }
    days.sort();
    days
}

async fn load_executions(
    exec_dir: &Path,
    hidden: &Tombstones,
    since: Option<&str>,
    limit: usize,
) -> Vec<Value> {
    let mut lines = Vec::new();
    for day in day_files(exec_dir, since, limit).await {
        lines.extend(read_jsonl(&exec_dir.join(format!("{day}.jsonl"))).await);
    }
    let executions = fold(lines)
        .into_iter()
        .filter(|record| !hidden.hides_execution(record))
        .collect();
    newest_first(executions, EXECUTIONS.day_field, limit)
}

fn started_since(run: &Value, since: Option<&str>) -> bool {
    since.is_none_or(|since| day_of(run, "startedAt").is_none_or(|day| day.as_str() >= since))
}

/// A run is hidden by its own tombstone in the index, or by its session's
/// in the executions tombstones (`executions`).
async fn load_trajectories(
    traj_dir: &Path,
    executions: &Tombstones,
    since: Option<&str>,
    limit: usize,
) -> Vec<Value> {
    let index = if limit > 0 {
        read_jsonl(&traj_dir.join(INDEX)).await
    } else {
        Vec::new()
    };
    let index_tombstones = Tombstones::collect(&index);
    let runs = fold(index.into_iter().filter(|line| !is_tombstone(line)))
        .into_iter()
        .filter(|run| {
            !index_tombstones.hides_run(run)
                && !executions.hides_session(run)
                && started_since(run, since)
        })
        .collect();
    newest_first(runs, "startedAt", limit)
}

pub async fn load_at(
    state: &ObservabilityState,
    root: &Path,
    since_day: Option<String>,
    limit: usize,
    trajectory_limit: usize,
) -> Result<LoadResult, String> {
    let _guard = state.lock.lock().await;
    let base = root.join(DIR);
    if fs::metadata(&base).await.is_err() {
        return Ok(LoadResult::default());
    }
    let exec_dir = base.join(EXECUTIONS.dir);
    let tombstones = Tombstones::collect(&read_jsonl(&exec_dir.join(TOMBSTONES)).await);
    let since = since_day.as_deref();
    Ok(LoadResult {
        executions: load_executions(&exec_dir, &tombstones, since, limit).await,
        trajectories: load_trajectories(
            &base.join(TRAJECTORIES),
            &tombstones,
            since,
            trajectory_limit,
        )
        .await,
        bytes: dir_bytes(&base).await,
    })
}

pub async fn load_trajectory_at(
    state: &ObservabilityState,
    root: &Path,
    run_id: &str,
) -> Result<Vec<Value>, String> {
    let path =
        run_entries_path(&root.join(DIR).join(TRAJECTORIES), run_id).ok_or("invalid run id")?;
    let _guard = state.lock.lock().await;
    Ok(read_jsonl(&path).await)
}

/// Deletes a run's entries file. A run may have none yet, so a missing file
/// is fine; any other failure is logged, and the tombstone written after it
/// still hides the run.
async fn remove_run_entries(path: &Path) {
    if let Err(error) = fs::remove_file(path).await {
        if error.kind() != std::io::ErrorKind::NotFound {
            eprintln!(
                "Failed to remove trajectory entries {}: {error}",
                path.display()
            );
        }
    }
}

/// The entries files of the runs a session started, per the trajectory index.
async fn session_run_files(traj_dir: &Path, session_id: &str) -> Vec<PathBuf> {
    let index = read_jsonl(&traj_dir.join(INDEX)).await;
    fold(index.into_iter().filter(|line| !is_tombstone(line)))
        .iter()
        .filter(|run| session_of(run) == Some(session_id))
        .filter_map(|run| id_of(run).and_then(|run_id| run_entries_path(traj_dir, run_id)))
        .collect()
}

async fn clear_all(base: &Path) -> Result<(), String> {
    if fs::metadata(base).await.is_ok() {
        fs::remove_dir_all(base)
            .await
            .map_err(|e| format!("failed to clear history: {e}"))?;
    }
    Ok(())
}

async fn delete_execution(base: &Path, id: &str) -> Result<(), String> {
    let dir = base.join(EXECUTIONS.dir);
    ensure_dir(&dir).await?;
    append_lines(&dir.join(TOMBSTONES), &[tombstone("execution", id)]).await
}

/// Hides a session's executions and runs, and deletes its runs' entries.
async fn delete_session(base: &Path, id: &str) -> Result<(), String> {
    let exec_dir = base.join(EXECUTIONS.dir);
    let traj_dir = base.join(TRAJECTORIES);
    ensure_dir(&exec_dir).await?;
    ensure_dir(&traj_dir).await?;
    append_lines(&exec_dir.join(TOMBSTONES), &[tombstone("session", id)]).await?;
    for path in session_run_files(&traj_dir, id).await {
        remove_run_entries(&path).await;
    }
    append_lines(&traj_dir.join(INDEX), &[tombstone("session", id)]).await
}

async fn delete_run(base: &Path, id: &str) -> Result<(), String> {
    let traj_dir = base.join(TRAJECTORIES);
    let path = run_entries_path(&traj_dir, id).ok_or("invalid run id")?;
    ensure_dir(&traj_dir).await?;
    remove_run_entries(&path).await;
    append_lines(&traj_dir.join(INDEX), &[tombstone("run", id)]).await
}

pub async fn delete_at(
    state: &ObservabilityState,
    root: &Path,
    scope: DeleteScope,
) -> Result<(), String> {
    let _guard = state.lock.lock().await;
    let base = root.join(DIR);
    match scope {
        DeleteScope::All => clear_all(&base).await,
        DeleteScope::Execution { id } => delete_execution(&base, &id).await,
        DeleteScope::Session { id } => delete_session(&base, &id).await,
        DeleteScope::Run { id } => delete_run(&base, &id).await,
    }
}

async fn resolve_root(
    app: &tauri::AppHandle,
    workspace_root: Option<String>,
) -> Result<PathBuf, String> {
    match workspace_root.filter(|root| !root.trim().is_empty()) {
        Some(root) => {
            let path = PathBuf::from(root);
            let meta = fs::metadata(&path)
                .await
                .map_err(|e| format!("workspace root is not accessible: {e}"))?;
            if !meta.is_dir() {
                return Err("workspace root is not a directory".into());
            }
            Ok(path.join(".rusty"))
        }
        None => {
            use tauri::Manager;
            app.path()
                .app_local_data_dir()
                .map_err(|e| format!("could not resolve app local data dir: {e}"))
        }
    }
}

#[tauri::command]
pub async fn observability_append(
    app: tauri::AppHandle,
    state: tauri::State<'_, ObservabilityState>,
    workspace_root: Option<String>,
    stream: Stream,
    run_id: Option<String>,
    lines: Vec<Value>,
) -> Result<(), String> {
    let root = resolve_root(&app, workspace_root).await?;
    append_at(&state, &root, stream, run_id, lines).await
}

#[tauri::command]
pub async fn observability_load(
    app: tauri::AppHandle,
    state: tauri::State<'_, ObservabilityState>,
    workspace_root: Option<String>,
    since_day: Option<String>,
    limit: usize,
    trajectory_limit: usize,
) -> Result<LoadResult, String> {
    let root = resolve_root(&app, workspace_root).await?;
    load_at(&state, &root, since_day, limit, trajectory_limit).await
}

#[tauri::command]
pub async fn observability_load_trajectory(
    app: tauri::AppHandle,
    state: tauri::State<'_, ObservabilityState>,
    workspace_root: Option<String>,
    run_id: String,
) -> Result<Vec<Value>, String> {
    let root = resolve_root(&app, workspace_root).await?;
    load_trajectory_at(&state, &root, &run_id).await
}

#[tauri::command]
pub async fn observability_delete(
    app: tauri::AppHandle,
    state: tauri::State<'_, ObservabilityState>,
    workspace_root: Option<String>,
    scope: DeleteScope,
) -> Result<(), String> {
    let root = resolve_root(&app, workspace_root).await?;
    delete_at(&state, &root, scope).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn record(id: &str, session: &str, day: &str, status: &str) -> Value {
        json!({ "id": id, "sessionId": session, "requestedAt": format!("{day}T10:00:00Z"), "status": status })
    }

    #[tokio::test]
    async fn appends_and_folds_last_snapshot_per_id() {
        let dir = tempfile::tempdir().unwrap();
        let state = ObservabilityState::default();
        append_at(
            &state,
            dir.path(),
            Stream::Executions,
            None,
            vec![record("a", "s1", "2026-09-01", "running")],
        )
        .await
        .unwrap();
        append_at(
            &state,
            dir.path(),
            Stream::Executions,
            None,
            vec![
                record("a", "s1", "2026-09-01", "succeeded"),
                record("b", "s1", "2026-09-02", "queued"),
            ],
        )
        .await
        .unwrap();

        let loaded = load_at(&state, dir.path(), None, 100, 100).await.unwrap();
        assert_eq!(loaded.executions.len(), 2);
        assert_eq!(loaded.executions[0]["id"], "b", "newest first");
        assert_eq!(loaded.executions[1]["status"], "succeeded");
        assert!(dir
            .path()
            .join("observability/executions/2026-09-01.jsonl")
            .exists());
        assert!(dir.path().join("observability/.gitignore").exists());
        assert!(loaded.bytes > 0);
    }

    #[tokio::test]
    async fn appends_diagnostics_by_day() {
        let dir = tempfile::tempdir().unwrap();
        let state = ObservabilityState::default();
        append_at(&state, dir.path(), Stream::Diagnostics, None, vec![
            json!({ "id": "d1", "timestamp": "2026-09-01T10:00:00Z", "level": "warn", "message": "failed" }),
        ]).await.unwrap();
        let path = dir
            .path()
            .join("observability/diagnostics/2026-09-01.jsonl");
        assert!(path.exists());
        let raw = std::fs::read_to_string(path).unwrap();
        assert!(raw.contains("failed"));
    }

    #[tokio::test]
    async fn since_day_and_limit_bound_the_load() {
        let dir = tempfile::tempdir().unwrap();
        let state = ObservabilityState::default();
        let lines = (1..=9)
            .map(|d| record(&format!("r{d}"), "s", &format!("2026-09-0{d}"), "succeeded"))
            .collect();
        append_at(&state, dir.path(), Stream::Executions, None, lines)
            .await
            .unwrap();

        let loaded = load_at(&state, dir.path(), Some("2026-09-05".into()), 3, 100)
            .await
            .unwrap();
        let ids: Vec<&str> = loaded
            .executions
            .iter()
            .map(|r| r["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, vec!["r9", "r8", "r7"]);
    }

    #[tokio::test]
    async fn tombstones_hide_executions_and_sessions() {
        let dir = tempfile::tempdir().unwrap();
        let state = ObservabilityState::default();
        append_at(
            &state,
            dir.path(),
            Stream::Executions,
            None,
            vec![
                record("a", "s1", "2026-09-01", "succeeded"),
                record("b", "s2", "2026-09-01", "succeeded"),
                record("c", "s2", "2026-09-01", "succeeded"),
                record("d", "s3", "2026-09-01", "succeeded"),
            ],
        )
        .await
        .unwrap();
        append_at(
            &state,
            dir.path(),
            Stream::TrajectoryIndex,
            None,
            vec![json!({ "id": "run-2", "sessionId": "s2", "startedAt": "2026-09-01T10:00:00Z" })],
        )
        .await
        .unwrap();
        append_at(
            &state,
            dir.path(),
            Stream::TrajectoryEntries,
            Some("run-2".into()),
            vec![json!({ "source": "x" })],
        )
        .await
        .unwrap();

        delete_at(
            &state,
            dir.path(),
            DeleteScope::Execution { id: "a".into() },
        )
        .await
        .unwrap();
        delete_at(&state, dir.path(), DeleteScope::Session { id: "s2".into() })
            .await
            .unwrap();

        let loaded = load_at(&state, dir.path(), None, 100, 100).await.unwrap();
        let ids: Vec<&str> = loaded
            .executions
            .iter()
            .map(|r| r["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, vec!["d"]);
        assert!(loaded.trajectories.is_empty());
        assert!(!dir
            .path()
            .join("observability/trajectories/run-2.jsonl")
            .exists());
    }

    #[tokio::test]
    async fn trajectory_index_folds_and_entries_load_by_run() {
        let dir = tempfile::tempdir().unwrap();
        let state = ObservabilityState::default();
        append_at(&state, dir.path(), Stream::TrajectoryIndex, None, vec![
            json!({ "id": "run-1", "startedAt": "2026-09-01T10:00:00Z", "status": "running" }),
            json!({ "id": "run-1", "startedAt": "2026-09-01T10:00:00Z", "status": "completed" }),
        ]).await.unwrap();
        append_at(
            &state,
            dir.path(),
            Stream::TrajectoryEntries,
            Some("run-1".into()),
            vec![json!({ "n": 1 }), json!({ "n": 2 })],
        )
        .await
        .unwrap();

        let loaded = load_at(&state, dir.path(), None, 100, 100).await.unwrap();
        assert_eq!(loaded.trajectories.len(), 1);
        assert_eq!(loaded.trajectories[0]["status"], "completed");
        let entries = load_trajectory_at(&state, dir.path(), "run-1")
            .await
            .unwrap();
        assert_eq!(entries.len(), 2);

        delete_at(&state, dir.path(), DeleteScope::Run { id: "run-1".into() })
            .await
            .unwrap();
        assert!(load_at(&state, dir.path(), None, 100, 100)
            .await
            .unwrap()
            .trajectories
            .is_empty());
        assert!(load_trajectory_at(&state, dir.path(), "run-1")
            .await
            .unwrap()
            .is_empty());
        assert!(
            delete_at(&state, dir.path(), DeleteScope::Run { id: "../x".into() })
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn clear_all_removes_everything() {
        let dir = tempfile::tempdir().unwrap();
        let state = ObservabilityState::default();
        append_at(
            &state,
            dir.path(),
            Stream::Executions,
            None,
            vec![record("a", "s1", "2026-09-01", "succeeded")],
        )
        .await
        .unwrap();
        delete_at(&state, dir.path(), DeleteScope::All)
            .await
            .unwrap();
        let loaded = load_at(&state, dir.path(), None, 100, 100).await.unwrap();
        assert!(loaded.executions.is_empty());
        assert_eq!(loaded.bytes, 0);
    }

    #[tokio::test]
    async fn rejects_path_traversal_in_run_ids() {
        let dir = tempfile::tempdir().unwrap();
        let state = ObservabilityState::default();
        for bad in ["../escape", "a/b", "", "..", "x.jsonl"] {
            assert!(
                append_at(
                    &state,
                    dir.path(),
                    Stream::TrajectoryEntries,
                    Some(bad.into()),
                    vec![json!({})]
                )
                .await
                .is_err(),
                "{bad}"
            );
            assert!(
                load_trajectory_at(&state, dir.path(), bad).await.is_err(),
                "{bad}"
            );
        }
        assert!(append_at(
            &state,
            dir.path(),
            Stream::TrajectoryIndex,
            None,
            vec![json!({ "id": "../x" })]
        )
        .await
        .is_err());
    }

    #[tokio::test]
    async fn skips_torn_trailing_line() {
        let dir = tempfile::tempdir().unwrap();
        let state = ObservabilityState::default();
        append_at(
            &state,
            dir.path(),
            Stream::Executions,
            None,
            vec![record("a", "s1", "2026-09-01", "succeeded")],
        )
        .await
        .unwrap();
        let path = dir.path().join("observability/executions/2026-09-01.jsonl");
        let mut raw = std::fs::read_to_string(&path).unwrap();
        raw.push_str("{\"id\":\"b\",\"sta");
        std::fs::write(&path, raw).unwrap();
        let loaded = load_at(&state, dir.path(), None, 100, 100).await.unwrap();
        assert_eq!(loaded.executions.len(), 1);

        append_at(
            &state,
            dir.path(),
            Stream::Executions,
            None,
            vec![record("c", "s1", "2026-09-01", "succeeded")],
        )
        .await
        .unwrap();
        let loaded = load_at(&state, dir.path(), None, 100, 100).await.unwrap();
        assert_eq!(
            loaded.executions.len(),
            2,
            "append after a torn line must survive"
        );
    }

    #[tokio::test]
    async fn sessions_deleted_in_the_executions_tombstones_hide_their_runs() {
        // The fix in c4f6f0c: runs are judged by the executions file's session
        // tombstones, not only by the copy in the trajectory index.
        let dir = tempfile::tempdir().unwrap();
        let state = ObservabilityState::default();
        append_at(
            &state,
            dir.path(),
            Stream::TrajectoryIndex,
            None,
            vec![
                json!({ "id": "run-9", "sessionId": "s9", "startedAt": "2026-09-01T10:00:00Z" }),
                json!({ "id": "run-10", "sessionId": "s10", "startedAt": "2026-09-01T11:00:00Z" }),
            ],
        )
        .await
        .unwrap();
        let exec_dir = dir.path().join(DIR).join(EXECUTIONS.dir);
        ensure_dir(&exec_dir).await.unwrap();
        append_lines(&exec_dir.join(TOMBSTONES), &[tombstone("session", "s9")])
            .await
            .unwrap();

        let loaded = load_at(&state, dir.path(), None, 100, 100).await.unwrap();
        let ids: Vec<&str> = loaded
            .trajectories
            .iter()
            .map(|r| r["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, vec!["run-10"]);
    }

    #[tokio::test]
    async fn deleting_a_run_without_entries_still_hides_it() {
        let dir = tempfile::tempdir().unwrap();
        let state = ObservabilityState::default();
        append_at(
            &state,
            dir.path(),
            Stream::TrajectoryIndex,
            None,
            vec![json!({ "id": "run-3", "sessionId": "s3", "startedAt": "2026-09-01T10:00:00Z" })],
        )
        .await
        .unwrap();

        delete_at(&state, dir.path(), DeleteScope::Run { id: "run-3".into() })
            .await
            .unwrap();

        assert!(load_at(&state, dir.path(), None, 100, 100)
            .await
            .unwrap()
            .trajectories
            .is_empty());
    }
}
