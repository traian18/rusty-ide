//! A call whose paths lie in several repositories becomes one call per repository, and their answers
//! one answer: the model asked one question about files that happen to live apart (a protocol type
//! in rusty-core and the IDE code that consumes it), so it should not have to split it itself.
use serde_json::{json, Map, Value};

use super::{
    directory::{resolve, RepoRef},
    error::RepositoryError,
    registry::RepositoryState,
    routing::{is_path, repository_json, split_anchor},
};

/// The lists of paths a call may carry; each is split by repository.
const LISTS: [&str; 2] = ["targets", "changed_files"];

/// The call split by repository, in the order the repositories are first named; `None` when its
/// paths are all in one repository, or it names its repository, or nothing can be told apart.
pub fn split(
    state: &RepositoryState,
    workspace: &str,
    active: Option<&str>,
    arguments: &Value,
) -> Result<Option<Vec<Value>>, RepositoryError> {
    let Some(map) = arguments.as_object() else {
        return Ok(None);
    };
    if map.contains_key("repository") {
        return Ok(None);
    }
    let workspace_path = std::fs::canonicalize(workspace)
        .map_err(|e| RepositoryError::invalid(format!("workspace root is not usable: {e}")))?;
    let repos = state.directory().repositories(workspace)?;
    let repository_of = |target: &str| -> Option<String> {
        if !is_path(target) {
            return None;
        }
        resolve(
            &repos,
            &workspace_path,
            None,
            Some(split_anchor(target).0),
            active,
        )
        .ok()
        .map(|resolution| resolution.repository.id)
    };

    // The call's other arguments, without its paths: each part gets its own.
    let mut base = map.clone();
    for key in LISTS.iter().chain(&["target"]) {
        base.remove(*key);
    }
    let mut parts: Vec<(String, Map<String, Value>)> = Vec::new();
    let mut unplaced = false;
    if let Some(target) = map.get("target").and_then(Value::as_str) {
        match repository_of(target) {
            Some(repository) => {
                part(&mut parts, &base, repository).insert("target".into(), json!(target));
            }
            None => unplaced = true,
        }
    }
    for key in LISTS {
        for item in map.get(key).and_then(Value::as_array).into_iter().flatten() {
            let Some(text) = item.as_str() else { continue };
            match repository_of(text) {
                Some(repository) => part(&mut parts, &base, repository)
                    .entry(key)
                    .or_insert_with(|| json!([]))
                    .as_array_mut()
                    .expect("a list")
                    .push(item.clone()),
                None => unplaced = true,
            }
        }
    }
    // One repository needs no splitting; a path no repository holds is for `route` to report.
    if parts.len() < 2 || unplaced {
        return Ok(None);
    }
    Ok(Some(
        parts
            .into_iter()
            .map(|(_, part)| Value::Object(part))
            .collect(),
    ))
}

/// The part of the call for `repository`, started from `base` when it is the first path there.
fn part<'a>(
    parts: &'a mut Vec<(String, Map<String, Value>)>,
    base: &Map<String, Value>,
    repository: String,
) -> &'a mut Map<String, Value> {
    let index = match parts.iter().position(|(id, _)| *id == repository) {
        Some(index) => index,
        None => {
            parts.push((repository, base.clone()));
            parts.len() - 1
        }
    };
    &mut parts[index].1
}

/// One answer from each repository's: its sections keyed by repository name, every suggested call
/// (each already names its repository), and a summary that says which part is which.
pub fn merge(answers: Vec<(RepoRef, Result<Value, RepositoryError>)>) -> Value {
    let mut sections = Map::new();
    let mut summaries = Vec::new();
    let mut next = Vec::new();
    let mut failed = 0;
    let mut repositories = Vec::new();
    for (repository, answer) in answers {
        repositories.push(repository_json(&repository));
        let result = match answer {
            Ok(output) => output.get("result").cloned().unwrap_or(output),
            Err(error) => {
                failed += 1;
                json!({"status": "error", "summary": format!("{}: {}", error.code, error.message)})
            }
        };
        summaries.push(format!(
            "{}: {}",
            repository.name,
            result["summary"].as_str().unwrap_or("")
        ));
        if let Some(calls) = result["next"].as_array() {
            next.extend(calls.iter().cloned());
        }
        let mut part = result;
        if let Some(object) = part.as_object_mut() {
            object.remove("next");
            object.insert("repository".into(), repository_json(&repository));
        }
        sections.insert(repository.name.clone(), part);
    }
    let status = if failed == 0 { "ok" } else { "partial" };
    json!({
        "result": {
            "status": status,
            "summary": summaries.join("; "),
            "split": "these paths are in different repositories; each answered for its own, under its name",
            "sections": sections,
            "next": next,
        },
        "repositories": repositories,
    })
}
