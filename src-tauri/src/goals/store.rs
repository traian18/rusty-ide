//! Goals as files: `<workspace>/.rusty/goals/<id>.json`, and next to it `<id>.checkpoint.json`, the
//! workspace snapshot the running pass started from. Writes go through a temporary file.
use std::path::{Path, PathBuf};

use harness_goals::{Goal, GOALS_DIR};
use harness_runtime::workspace_snapshot::Snapshot;
use serde::{de::DeserializeOwned, Serialize};

use crate::repository::error::RepositoryError;

fn io(error: impl std::fmt::Display) -> RepositoryError {
    RepositoryError::new("io_error", error.to_string())
}

fn folder(root: &Path) -> PathBuf {
    root.join(GOALS_DIR)
}

fn valid_id(id: &str) -> Result<&str, RepositoryError> {
    if !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        Ok(id)
    } else {
        Err(RepositoryError::invalid(format!("'{id}' is not a goal id")))
    }
}

fn write_json(path: &Path, value: &impl Serialize) -> Result<(), RepositoryError> {
    std::fs::create_dir_all(path.parent().expect("inside the goals folder")).map_err(io)?;
    let text = serde_json::to_string_pretty(value).map_err(io)?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, text).map_err(io)?;
    std::fs::rename(&temporary, path).map_err(io)
}

fn read_json<T: DeserializeOwned>(path: &Path) -> Result<Option<T>, RepositoryError> {
    match std::fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).map(Some).map_err(io),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(io(error)),
    }
}

pub(super) fn save(root: &Path, goal: &Goal) -> Result<(), RepositoryError> {
    write_json(
        &folder(root).join(format!("{}.json", valid_id(&goal.id)?)),
        goal,
    )
}

pub(super) fn load(root: &Path, id: &str) -> Result<Goal, RepositoryError> {
    read_json(&folder(root).join(format!("{}.json", valid_id(id)?)))?
        .ok_or_else(|| RepositoryError::new("not_found", format!("there is no goal {id}")))
}

/// Every goal in the workspace, the most recently updated first.
pub(super) fn list(root: &Path) -> Result<Vec<Goal>, RepositoryError> {
    let Ok(entries) = std::fs::read_dir(folder(root)) else {
        return Ok(Vec::new());
    };
    let mut goals: Vec<Goal> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension().is_some_and(|e| e == "json")
                && !path.to_string_lossy().ends_with(".checkpoint.json")
        })
        .filter_map(|path| read_json(&path).ok().flatten())
        .collect();
    goals.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(goals)
}

pub(super) fn delete(root: &Path, id: &str) -> Result<(), RepositoryError> {
    let id = valid_id(id)?;
    for name in [format!("{id}.json"), format!("{id}.checkpoint.json")] {
        match std::fs::remove_file(folder(root).join(name)) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(io(error)),
            _ => {}
        }
    }
    Ok(())
}

pub(super) fn save_checkpoint(
    root: &Path,
    id: &str,
    snapshot: &Snapshot,
) -> Result<(), RepositoryError> {
    write_json(
        &folder(root).join(format!("{}.checkpoint.json", valid_id(id)?)),
        snapshot,
    )
}

pub(super) fn checkpoint(root: &Path, id: &str) -> Result<Option<Snapshot>, RepositoryError> {
    read_json(&folder(root).join(format!("{}.checkpoint.json", valid_id(id)?)))
}

#[cfg(test)]
mod tests {
    use harness_goals::Goal;

    use super::{delete, list, load, save};

    #[test]
    fn goals_round_trip_and_list_newest_first() {
        let dir = tempfile::tempdir().unwrap();
        let mut older = Goal::new("g-1".into(), "one".into(), "2026-10-27T10:00:00Z".into());
        save(dir.path(), &older).unwrap();
        let newer = Goal::new("g-2".into(), "two".into(), "2026-10-27T11:00:00Z".into());
        save(dir.path(), &newer).unwrap();
        older.instruction = "one, edited".into();
        save(dir.path(), &older).unwrap();
        assert_eq!(load(dir.path(), "g-1").unwrap().instruction, "one, edited");
        let ids: Vec<String> = list(dir.path())
            .unwrap()
            .into_iter()
            .map(|g| g.id)
            .collect();
        assert_eq!(ids, ["g-2", "g-1"]);
        delete(dir.path(), "g-2").unwrap();
        assert_eq!(list(dir.path()).unwrap().len(), 1);
        assert!(load(dir.path(), "../x").is_err());
    }
}
