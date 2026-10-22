//! What the stored lines mean: record ids and days, run ids that are safe
//! file names, deletions recorded as tombstones, and snapshot folding.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde_json::Value;

pub(super) fn valid_run_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 200
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// A run's entries file, or None for a run id that is not a plain name, so
/// no caller can build a path outside the trajectories directory.
pub(super) fn run_entries_path(traj_dir: &Path, run_id: &str) -> Option<PathBuf> {
    valid_run_id(run_id).then(|| traj_dir.join(format!("{run_id}.jsonl")))
}

pub(super) fn id_of(value: &Value) -> Option<&str> {
    value.get("id").and_then(Value::as_str)
}

pub(super) fn session_of(value: &Value) -> Option<&str> {
    value.get("sessionId").and_then(Value::as_str)
}

pub(super) fn day_of(value: &Value, field: &str) -> Option<String> {
    let day: String = value.get(field)?.as_str()?.chars().take(10).collect();
    let bytes = day.as_bytes();
    let ok = bytes.len() == 10
        && bytes.iter().enumerate().all(|(i, b)| {
            if i == 4 || i == 7 {
                *b == b'-'
            } else {
                b.is_ascii_digit()
            }
        });
    ok.then_some(day)
}

pub(super) fn today() -> String {
    crate::chrono_now_iso8601().chars().take(10).collect()
}

pub(super) fn tombstone(kind: &str, id: &str) -> String {
    serde_json::json!({ "$tombstone": { "kind": kind, "id": id }, "ts": crate::chrono_now_iso8601() }).to_string()
}

pub(super) fn is_tombstone(line: &Value) -> bool {
    line.get("$tombstone").is_some()
}

/// Deletions read from one file. The executions tombstones file holds
/// execution and session tombstones; the trajectory index holds run
/// tombstones and a copy of the session ones. Sessions are judged by the
/// executions file's set, for runs too.
#[derive(Default)]
pub(super) struct Tombstones {
    executions: HashSet<String>,
    sessions: HashSet<String>,
    runs: HashSet<String>,
}

impl Tombstones {
    pub(super) fn collect(lines: &[Value]) -> Self {
        let mut tombstones = Self::default();
        for line in lines {
            let Some(ts) = line.get("$tombstone") else {
                continue;
            };
            let (Some(kind), Some(id)) = (
                ts.get("kind").and_then(Value::as_str),
                ts.get("id").and_then(Value::as_str),
            ) else {
                continue;
            };
            let set = match kind {
                "execution" => &mut tombstones.executions,
                "session" => &mut tombstones.sessions,
                "run" => &mut tombstones.runs,
                _ => continue,
            };
            set.insert(id.to_string());
        }
        tombstones
    }

    pub(super) fn hides_session(&self, value: &Value) -> bool {
        session_of(value).is_some_and(|session| self.sessions.contains(session))
    }

    pub(super) fn hides_execution(&self, record: &Value) -> bool {
        self.executions.contains(id_of(record).unwrap_or_default()) || self.hides_session(record)
    }

    pub(super) fn hides_run(&self, run: &Value) -> bool {
        self.runs.contains(id_of(run).unwrap_or_default())
    }
}

/// Folds snapshots last-wins by `id`, preserving first-seen order.
pub(super) fn fold(lines: impl IntoIterator<Item = Value>) -> Vec<Value> {
    let mut order: Vec<String> = Vec::new();
    let mut latest: HashMap<String, Value> = HashMap::new();
    for line in lines {
        let Some(id) = id_of(&line).map(str::to_string) else {
            continue;
        };
        if !latest.contains_key(&id) {
            order.push(id.clone());
        }
        latest.insert(id, line);
    }
    order
        .into_iter()
        .filter_map(|id| latest.remove(&id))
        .collect()
}

/// Newest first by an ISO timestamp field (records without one last),
/// keeping the first `limit`.
pub(super) fn newest_first(mut values: Vec<Value>, field: &str, limit: usize) -> Vec<Value> {
    let key = |v: &Value| {
        v.get(field)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    values.sort_by_key(|value| std::cmp::Reverse(key(value)));
    values.truncate(limit);
    values
}
