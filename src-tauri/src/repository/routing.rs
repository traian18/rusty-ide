//! Sends a tool call to the repository it is about. A call's `repository` argument and the paths
//! it names decide which repository's documentation answers it; paths are rewritten relative to
//! that repository, and the answer says which repository it came from and repeats it in the calls it
//! suggests, so a model that follows them stays in the same place.
use serde_json::{json, Map, Value};

use super::{
    directory::{resolve, RepoRef, Resolution},
    error::RepositoryError,
    registry::RepositoryState,
};

/// Page-id prefixes: a target written this way names a page, not a path.
const PAGE_PREFIXES: [&str; 6] = ["file:", "folder:", "package:", "repo:", "dir:", "rest:"];

pub(super) fn is_path(target: &str) -> bool {
    !target.is_empty()
        && !PAGE_PREFIXES
            .iter()
            .any(|prefix| target.starts_with(prefix))
}

/// `src/a.rs::Type.method` and `src/a.rs:10-40` name a place in a file: the path, and the rest.
pub(super) fn split_anchor(target: &str) -> (&str, &str) {
    if let Some(at) = target.find("::") {
        return target.split_at(at);
    }
    match target.rsplit_once(':') {
        Some((path, range))
            if !range.is_empty() && range.chars().all(|c| c.is_ascii_digit() || c == '-') =>
        {
            target.split_at(path.len())
        }
        _ => (target, ""),
    }
}

/// `repoA#file:src/a.rs` names a page in `repoA`.
fn split_qualified(target: &str) -> (Option<&str>, &str) {
    match target.split_once('#') {
        Some((repository, page))
            if !repository.is_empty()
                && PAGE_PREFIXES.iter().any(|prefix| page.starts_with(prefix)) =>
        {
            (Some(repository), page)
        }
        _ => (None, target),
    }
}

/// The repository a call is for and its arguments rewritten for that repository.
pub fn route(
    state: &RepositoryState,
    workspace: &str,
    active: Option<&str>,
    arguments: Value,
) -> Result<(RepoRef, Value), RepositoryError> {
    let mut arguments = arguments;
    let Some(map) = arguments.as_object_mut() else {
        return Err(RepositoryError::invalid("arguments must be an object"));
    };
    let mut explicit = map
        .remove("repository")
        .and_then(|v| v.as_str().map(str::to_owned));
    let workspace_path = std::fs::canonicalize(workspace)
        .map_err(|e| RepositoryError::invalid(format!("workspace root is not usable: {e}")))?;
    let repos = state.directory().repositories(workspace)?;

    // Paths the call names, in the order given: `target`, then `targets`.
    let mut paths: Vec<String> = Vec::new();
    if let Some(target) = map.get("target").and_then(Value::as_str).map(str::to_owned) {
        let (qualified, rest) = split_qualified(&target);
        if explicit.is_none() {
            explicit = qualified.map(str::to_owned);
        }
        if rest != target {
            map.insert("target".into(), json!(rest));
        }
        if is_path(rest) {
            paths.push(split_anchor(rest).0.to_owned());
        }
    }
    let list = |key: &str| -> Vec<String> {
        map.get(key)
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|t| t.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default()
    };
    let targets = list("targets");
    let changed = list("changed_files");
    paths.extend(
        targets
            .iter()
            .chain(&changed)
            .filter(|t| is_path(t))
            .map(|t| split_anchor(t).0.to_owned()),
    );

    let mut resolved: Option<Resolution> = None;
    for path in &paths {
        let this = resolve(
            &repos,
            &workspace_path,
            explicit.as_deref(),
            Some(path),
            active,
        )
        .map_err(|e| e.into_error())?;
        match &resolved {
            Some(first) if first.repository.id != this.repository.id => {
                return Err(RepositoryError::new(
                    "spans_repositories",
                    format!("these paths are in different repositories ({} and {}); make one call per repository", first.repository.name, this.repository.name),
                ));
            }
            Some(_) => {}
            None => resolved = Some(this),
        }
    }
    let resolved = match resolved {
        Some(resolved) => resolved,
        None => resolve(&repos, &workspace_path, explicit.as_deref(), None, active)
            .map_err(|e| e.into_error())?,
    };
    let repository = resolved.repository.clone();

    // Rewrite every path relative to the repository, keeping a symbol or range after it.
    let relative = |target: &str| -> String {
        let (path, anchor) = split_anchor(target);
        let path = resolve(
            &repos,
            &workspace_path,
            Some(&repository.id),
            Some(path),
            None,
        )
        .ok()
        .and_then(|r| r.path)
        .unwrap_or_else(|| path.to_owned());
        format!("{path}{anchor}")
    };
    if let Some(target) = map
        .get("target")
        .and_then(Value::as_str)
        .filter(|t| is_path(t))
        .map(str::to_owned)
    {
        map.insert("target".into(), json!(relative(&target)));
    }
    for (key, values) in [("targets", &targets), ("changed_files", &changed)] {
        if !values.is_empty() {
            map.insert(
                key.into(),
                json!(values
                    .iter()
                    .map(|t| if is_path(t) { relative(t) } else { t.clone() })
                    .collect::<Vec<_>>()),
            );
        }
    }
    Ok((repository, arguments))
}

/// The answer, with the repository it came from, and `repository` repeated in every call it suggests.
pub fn stamp(mut output: Value, repository: &RepoRef) -> Value {
    if let Some(result) = output.get_mut("result").and_then(Value::as_object_mut) {
        if let Some(next) = result.get_mut("next").and_then(Value::as_array_mut) {
            for call in next {
                if let Some(arguments) = call.get_mut("arguments").and_then(Value::as_object_mut) {
                    arguments.insert("repository".into(), json!(repository.id));
                }
            }
        }
    }
    if let Some(map) = output.as_object_mut() {
        map.insert("repository".into(), repository_json(repository));
    }
    output
}

pub fn repository_json(repository: &RepoRef) -> Value {
    let mut map = Map::new();
    map.insert("id".into(), json!(repository.id));
    map.insert("name".into(), json!(repository.name));
    map.insert(
        "path".into(),
        json!(if repository.relative.is_empty() {
            "."
        } else {
            repository.relative.as_str()
        }),
    );
    map.insert("branch".into(), json!(repository.branch));
    Value::Object(map)
}

/// Runs one read-only repository tool for the repository the call is about; a call whose paths
/// lie in several repositories runs once for each, and their answers come back as one.
pub async fn run_tool(
    state: &RepositoryState,
    workspace: &str,
    active: Option<&str>,
    tool: &str,
    arguments: Value,
) -> Result<Value, RepositoryError> {
    let Some(parts) = super::routing_split::split(state, workspace, active, &arguments)? else {
        return run_one(state, workspace, active, tool, arguments)
            .await
            .map(|(_, output)| output);
    };
    let mut answers = Vec::new();
    for part in parts {
        let (repository, _) = route(state, workspace, active, part.clone())?;
        let answer = run_one(state, workspace, active, tool, part)
            .await
            .map(|(_, output)| output);
        answers.push((repository, answer));
    }
    Ok(super::routing_split::merge(answers))
}

async fn run_one(
    state: &RepositoryState,
    workspace: &str,
    active: Option<&str>,
    tool: &str,
    arguments: Value,
) -> Result<(RepoRef, Value), RepositoryError> {
    let (repository, arguments) = route(state, workspace, active, arguments)?;
    let entry = state.entry(&repository.root.to_string_lossy())?;
    let output = super::agent_tools::run(entry, tool, arguments).await?;
    Ok((repository.clone(), stamp(output, &repository)))
}
