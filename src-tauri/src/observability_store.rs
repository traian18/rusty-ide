//! Append-only JSONL execution history under `<workspace>/.rusty/observability/` (last snapshot per id wins).

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::fs;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::sync::Mutex;

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

fn valid_run_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 200 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn day_of(value: &Value, field: &str) -> Option<String> {
    let day: String = value.get(field)?.as_str()?.chars().take(10).collect();
    let bytes = day.as_bytes();
    let ok = bytes.len() == 10
        && bytes.iter().enumerate().all(|(i, b)| if i == 4 || i == 7 { *b == b'-' } else { b.is_ascii_digit() });
    ok.then_some(day)
}

fn today() -> String {
    crate::chrono_now_iso8601().chars().take(10).collect()
}

async fn ensure_dir(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).await.map_err(|e| format!("failed to create {}: {e}", dir.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700)).await;
    }
    Ok(())
}

/// Keeps history out of the workspace's git repo without touching its own .gitignore.
async fn ensure_gitignore(dir: &Path) {
    let path = dir.join(".gitignore");
    if fs::metadata(&path).await.is_err() {
        let _ = fs::write(&path, "*\n").await;
    }
}

async fn ends_mid_line(path: &Path) -> bool {
    let Ok(mut file) = fs::File::open(path).await else { return false };
    let Ok(len) = file.metadata().await.map(|m| m.len()) else { return false };
    if len == 0 || file.seek(std::io::SeekFrom::Start(len - 1)).await.is_err() {
        return false;
    }
    let mut last = [0u8; 1];
    file.read_exact(&mut last).await.is_ok() && last[0] != b'\n'
}

async fn append_lines(path: &Path, lines: &[String]) -> Result<(), String> {
    if lines.is_empty() {
        return Ok(());
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await
        .map_err(|e| format!("failed to open {}: {e}", path.display()))?;
    let mut buf = String::with_capacity(lines.iter().map(|l| l.len() + 1).sum::<usize>() + 1);
    if ends_mid_line(path).await {
        // Isolate a torn line from a crashed write so it can't swallow this one.
        buf.push('\n');
    }
    for line in lines {
        buf.push_str(line);
        buf.push('\n');
    }
    file.write_all(buf.as_bytes()).await.map_err(|e| format!("failed to append to {}: {e}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).await;
    }
    Ok(())
}

async fn read_jsonl(path: &Path) -> Vec<Value> {
    match fs::read_to_string(path).await {
        // A crash mid-append can leave one torn last line; skip anything unparsable.
        Ok(raw) => raw.lines().filter_map(|line| serde_json::from_str(line).ok()).collect(),
        Err(_) => Vec::new(),
    }
}

fn tombstone(kind: &str, id: &str) -> String {
    serde_json::json!({ "$tombstone": { "kind": kind, "id": id }, "ts": crate::chrono_now_iso8601() }).to_string()
}

struct Tombstones {
    executions: HashSet<String>,
    sessions: HashSet<String>,
    runs: HashSet<String>,
}

fn collect_tombstones(lines: &[Value]) -> Tombstones {
    let mut t = Tombstones { executions: HashSet::new(), sessions: HashSet::new(), runs: HashSet::new() };
    for line in lines {
        let Some(ts) = line.get("$tombstone") else { continue };
        let (Some(kind), Some(id)) = (ts.get("kind").and_then(Value::as_str), ts.get("id").and_then(Value::as_str)) else { continue };
        match kind {
            "execution" => { t.executions.insert(id.to_string()); }
            "session" => { t.sessions.insert(id.to_string()); }
            "run" => { t.runs.insert(id.to_string()); }
            _ => {}
        }
    }
    t
}

fn session_of(value: &Value) -> Option<&str> {
    value.get("sessionId").and_then(Value::as_str)
}

/// Folds snapshots last-wins by `id`, preserving first-seen order.
fn fold(lines: impl IntoIterator<Item = Value>) -> Vec<Value> {
    let mut order: Vec<String> = Vec::new();
    let mut latest: HashMap<String, Value> = HashMap::new();
    for line in lines {
        let Some(id) = line.get("id").and_then(Value::as_str).map(str::to_string) else { continue };
        if !latest.contains_key(&id) {
            order.push(id.clone());
        }
        latest.insert(id, line);
    }
    order.into_iter().filter_map(|id| latest.remove(&id)).collect()
}

async fn dir_bytes(dir: &Path) -> u64 {
    let mut total = 0;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let Ok(mut entries) = fs::read_dir(&current).await else { continue };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let Ok(meta) = entry.metadata().await else { continue };
            if meta.is_dir() {
                stack.push(entry.path());
            } else {
                total += meta.len();
            }
        }
    }
    total
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
        Stream::Executions => {
            let dir = base.join("executions");
            ensure_dir(&dir).await?;
            let mut by_day: HashMap<String, Vec<String>> = HashMap::new();
            for line in lines {
                if line.get("id").and_then(Value::as_str).is_none() {
                    return Err("execution record is missing an id".into());
                }
                let day = day_of(&line, "requestedAt").unwrap_or_else(today);
                by_day.entry(day).or_default().push(line.to_string());
            }
            for (day, day_lines) in by_day {
                append_lines(&dir.join(format!("{day}.jsonl")), &day_lines).await?;
            }
        }
        Stream::TrajectoryIndex => {
            let dir = base.join("trajectories");
            ensure_dir(&dir).await?;
            if lines.iter().any(|l| l.get("id").and_then(Value::as_str).is_none_or(|id| !valid_run_id(id))) {
                return Err("trajectory index line has an invalid id".into());
            }
            let lines: Vec<String> = lines.iter().map(Value::to_string).collect();
            append_lines(&dir.join(INDEX), &lines).await?;
        }
        Stream::TrajectoryEntries => {
            let run_id = run_id.filter(|id| valid_run_id(id)).ok_or("invalid or missing run id")?;
            let dir = base.join("trajectories");
            ensure_dir(&dir).await?;
            let lines: Vec<String> = lines.iter().map(Value::to_string).collect();
            append_lines(&dir.join(format!("{run_id}.jsonl")), &lines).await?;
        }
        Stream::Diagnostics => {
            let dir = base.join("diagnostics");
            ensure_dir(&dir).await?;
            let mut by_day: HashMap<String, Vec<String>> = HashMap::new();
            for line in lines {
                if line.get("id").and_then(Value::as_str).is_none() {
                    return Err("diagnostic record is missing an id".into());
                }
                let day = day_of(&line, "timestamp").unwrap_or_else(today);
                by_day.entry(day).or_default().push(line.to_string());
            }
            for (day, day_lines) in by_day {
                append_lines(&dir.join(format!("{day}.jsonl")), &day_lines).await?;
            }
        }
    }
    Ok(())
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
    let exec_dir = base.join("executions");
    let tombstones = collect_tombstones(&read_jsonl(&exec_dir.join(TOMBSTONES)).await);

    let mut days: Vec<String> = Vec::new();
    let mut entries = if limit > 0 { fs::read_dir(&exec_dir).await.ok() } else { None };
    if let Some(entries) = entries.as_mut() {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let name = entry.file_name().to_string_lossy().to_string();
            if let Some(day) = name.strip_suffix(".jsonl") {
                if day != "tombstones" && since_day.as_deref().is_none_or(|since| day >= since) {
                    days.push(day.to_string());
                }
            }
        }
    }
    days.sort();
    let mut lines = Vec::new();
    for day in &days {
        lines.extend(read_jsonl(&exec_dir.join(format!("{day}.jsonl"))).await);
    }
    let mut executions: Vec<Value> = fold(lines)
        .into_iter()
        .filter(|record| {
            let id = record.get("id").and_then(Value::as_str).unwrap_or_default();
            !tombstones.executions.contains(id) && session_of(record).is_none_or(|s| !tombstones.sessions.contains(s))
        })
        .collect();
    executions.sort_by(|a, b| {
        let key = |v: &Value| v.get("requestedAt").and_then(Value::as_str).unwrap_or_default().to_string();
        key(b).cmp(&key(a))
    });
    executions.truncate(limit);

    let index = if trajectory_limit > 0 { read_jsonl(&base.join("trajectories").join(INDEX)).await } else { Vec::new() };
    let run_tombstones = collect_tombstones(&index);
    let mut trajectories: Vec<Value> = fold(index.into_iter().filter(|l| l.get("$tombstone").is_none()))
        .into_iter()
        .filter(|run| {
            let id = run.get("id").and_then(Value::as_str).unwrap_or_default();
            !run_tombstones.runs.contains(id)
                && session_of(run).is_none_or(|s| !tombstones.sessions.contains(s))
                && since_day.as_deref().is_none_or(|since| day_of(run, "startedAt").is_none_or(|d| d.as_str() >= since))
        })
        .collect();
    trajectories.sort_by(|a, b| {
        let key = |v: &Value| v.get("startedAt").and_then(Value::as_str).unwrap_or_default().to_string();
        key(b).cmp(&key(a))
    });
    trajectories.truncate(trajectory_limit);

    Ok(LoadResult { executions, trajectories, bytes: dir_bytes(&base).await })
}

pub async fn load_trajectory_at(state: &ObservabilityState, root: &Path, run_id: &str) -> Result<Vec<Value>, String> {
    if !valid_run_id(run_id) {
        return Err("invalid run id".into());
    }
    let _guard = state.lock.lock().await;
    Ok(read_jsonl(&root.join(DIR).join("trajectories").join(format!("{run_id}.jsonl"))).await)
}

pub async fn delete_at(state: &ObservabilityState, root: &Path, scope: DeleteScope) -> Result<(), String> {
    let _guard = state.lock.lock().await;
    let base = root.join(DIR);
    match scope {
        DeleteScope::All => {
            if fs::metadata(&base).await.is_ok() {
                fs::remove_dir_all(&base).await.map_err(|e| format!("failed to clear history: {e}"))?;
            }
        }
        DeleteScope::Execution { id } => {
            let dir = base.join("executions");
            ensure_dir(&dir).await?;
            append_lines(&dir.join(TOMBSTONES), &[tombstone("execution", &id)]).await?;
        }
        DeleteScope::Session { id } => {
            let exec_dir = base.join("executions");
            let traj_dir = base.join("trajectories");
            ensure_dir(&exec_dir).await?;
            ensure_dir(&traj_dir).await?;
            append_lines(&exec_dir.join(TOMBSTONES), &[tombstone("session", &id)]).await?;
            let runs = fold(read_jsonl(&traj_dir.join(INDEX)).await.into_iter().filter(|l| l.get("$tombstone").is_none()));
            for run in runs.iter().filter(|run| session_of(run) == Some(id.as_str())) {
                if let Some(run_id) = run.get("id").and_then(Value::as_str).filter(|r| valid_run_id(r)) {
                    let _ = fs::remove_file(traj_dir.join(format!("{run_id}.jsonl"))).await;
                }
            }
            append_lines(&traj_dir.join(INDEX), &[tombstone("session", &id)]).await?;
        }
        DeleteScope::Run { id } => {
            if !valid_run_id(&id) {
                return Err("invalid run id".into());
            }
            let traj_dir = base.join("trajectories");
            ensure_dir(&traj_dir).await?;
            let _ = fs::remove_file(traj_dir.join(format!("{id}.jsonl"))).await;
            append_lines(&traj_dir.join(INDEX), &[tombstone("run", &id)]).await?;
        }
    }
    Ok(())
}

async fn resolve_root(app: &tauri::AppHandle, workspace_root: Option<String>) -> Result<PathBuf, String> {
    match workspace_root.filter(|root| !root.trim().is_empty()) {
        Some(root) => {
            let path = PathBuf::from(root);
            let meta = fs::metadata(&path).await.map_err(|e| format!("workspace root is not accessible: {e}"))?;
            if !meta.is_dir() {
                return Err("workspace root is not a directory".into());
            }
            Ok(path.join(".rusty"))
        }
        None => {
            use tauri::Manager;
            app.path().app_local_data_dir().map_err(|e| format!("could not resolve app local data dir: {e}"))
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
        append_at(&state, dir.path(), Stream::Executions, None, vec![record("a", "s1", "2026-09-01", "running")]).await.unwrap();
        append_at(&state, dir.path(), Stream::Executions, None, vec![record("a", "s1", "2026-09-01", "succeeded"), record("b", "s1", "2026-09-02", "queued")]).await.unwrap();

        let loaded = load_at(&state, dir.path(), None, 100, 100).await.unwrap();
        assert_eq!(loaded.executions.len(), 2);
        assert_eq!(loaded.executions[0]["id"], "b", "newest first");
        assert_eq!(loaded.executions[1]["status"], "succeeded");
        assert!(dir.path().join("observability/executions/2026-09-01.jsonl").exists());
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
        let path = dir.path().join("observability/diagnostics/2026-09-01.jsonl");
        assert!(path.exists());
        let raw = std::fs::read_to_string(path).unwrap();
        assert!(raw.contains("failed"));
    }

    #[tokio::test]
    async fn since_day_and_limit_bound_the_load() {
        let dir = tempfile::tempdir().unwrap();
        let state = ObservabilityState::default();
        let lines = (1..=9).map(|d| record(&format!("r{d}"), "s", &format!("2026-09-0{d}"), "succeeded")).collect();
        append_at(&state, dir.path(), Stream::Executions, None, lines).await.unwrap();

        let loaded = load_at(&state, dir.path(), Some("2026-09-05".into()), 3, 100).await.unwrap();
        let ids: Vec<&str> = loaded.executions.iter().map(|r| r["id"].as_str().unwrap()).collect();
        assert_eq!(ids, vec!["r9", "r8", "r7"]);
    }

    #[tokio::test]
    async fn tombstones_hide_executions_and_sessions() {
        let dir = tempfile::tempdir().unwrap();
        let state = ObservabilityState::default();
        append_at(&state, dir.path(), Stream::Executions, None, vec![
            record("a", "s1", "2026-09-01", "succeeded"),
            record("b", "s2", "2026-09-01", "succeeded"),
            record("c", "s2", "2026-09-01", "succeeded"),
            record("d", "s3", "2026-09-01", "succeeded"),
        ]).await.unwrap();
        append_at(&state, dir.path(), Stream::TrajectoryIndex, None, vec![json!({ "id": "run-2", "sessionId": "s2", "startedAt": "2026-09-01T10:00:00Z" })]).await.unwrap();
        append_at(&state, dir.path(), Stream::TrajectoryEntries, Some("run-2".into()), vec![json!({ "source": "x" })]).await.unwrap();

        delete_at(&state, dir.path(), DeleteScope::Execution { id: "a".into() }).await.unwrap();
        delete_at(&state, dir.path(), DeleteScope::Session { id: "s2".into() }).await.unwrap();

        let loaded = load_at(&state, dir.path(), None, 100, 100).await.unwrap();
        let ids: Vec<&str> = loaded.executions.iter().map(|r| r["id"].as_str().unwrap()).collect();
        assert_eq!(ids, vec!["d"]);
        assert!(loaded.trajectories.is_empty());
        assert!(!dir.path().join("observability/trajectories/run-2.jsonl").exists());
    }

    #[tokio::test]
    async fn trajectory_index_folds_and_entries_load_by_run() {
        let dir = tempfile::tempdir().unwrap();
        let state = ObservabilityState::default();
        append_at(&state, dir.path(), Stream::TrajectoryIndex, None, vec![
            json!({ "id": "run-1", "startedAt": "2026-09-01T10:00:00Z", "status": "running" }),
            json!({ "id": "run-1", "startedAt": "2026-09-01T10:00:00Z", "status": "completed" }),
        ]).await.unwrap();
        append_at(&state, dir.path(), Stream::TrajectoryEntries, Some("run-1".into()), vec![json!({ "n": 1 }), json!({ "n": 2 })]).await.unwrap();

        let loaded = load_at(&state, dir.path(), None, 100, 100).await.unwrap();
        assert_eq!(loaded.trajectories.len(), 1);
        assert_eq!(loaded.trajectories[0]["status"], "completed");
        let entries = load_trajectory_at(&state, dir.path(), "run-1").await.unwrap();
        assert_eq!(entries.len(), 2);

        delete_at(&state, dir.path(), DeleteScope::Run { id: "run-1".into() }).await.unwrap();
        assert!(load_at(&state, dir.path(), None, 100, 100).await.unwrap().trajectories.is_empty());
        assert!(load_trajectory_at(&state, dir.path(), "run-1").await.unwrap().is_empty());
        assert!(delete_at(&state, dir.path(), DeleteScope::Run { id: "../x".into() }).await.is_err());
    }

    #[tokio::test]
    async fn clear_all_removes_everything() {
        let dir = tempfile::tempdir().unwrap();
        let state = ObservabilityState::default();
        append_at(&state, dir.path(), Stream::Executions, None, vec![record("a", "s1", "2026-09-01", "succeeded")]).await.unwrap();
        delete_at(&state, dir.path(), DeleteScope::All).await.unwrap();
        let loaded = load_at(&state, dir.path(), None, 100, 100).await.unwrap();
        assert!(loaded.executions.is_empty());
        assert_eq!(loaded.bytes, 0);
    }

    #[tokio::test]
    async fn rejects_path_traversal_in_run_ids() {
        let dir = tempfile::tempdir().unwrap();
        let state = ObservabilityState::default();
        for bad in ["../escape", "a/b", "", "..", "x.jsonl"] {
            assert!(append_at(&state, dir.path(), Stream::TrajectoryEntries, Some(bad.into()), vec![json!({})]).await.is_err(), "{bad}");
            assert!(load_trajectory_at(&state, dir.path(), bad).await.is_err(), "{bad}");
        }
        assert!(append_at(&state, dir.path(), Stream::TrajectoryIndex, None, vec![json!({ "id": "../x" })]).await.is_err());
    }

    #[tokio::test]
    async fn skips_torn_trailing_line() {
        let dir = tempfile::tempdir().unwrap();
        let state = ObservabilityState::default();
        append_at(&state, dir.path(), Stream::Executions, None, vec![record("a", "s1", "2026-09-01", "succeeded")]).await.unwrap();
        let path = dir.path().join("observability/executions/2026-09-01.jsonl");
        let mut raw = std::fs::read_to_string(&path).unwrap();
        raw.push_str("{\"id\":\"b\",\"sta");
        std::fs::write(&path, raw).unwrap();
        let loaded = load_at(&state, dir.path(), None, 100, 100).await.unwrap();
        assert_eq!(loaded.executions.len(), 1);

        append_at(&state, dir.path(), Stream::Executions, None, vec![record("c", "s1", "2026-09-01", "succeeded")]).await.unwrap();
        let loaded = load_at(&state, dir.path(), None, 100, 100).await.unwrap();
        assert_eq!(loaded.executions.len(), 2, "append after a torn line must survive");
    }
}
