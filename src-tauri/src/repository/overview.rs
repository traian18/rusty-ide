//! A workspace's repositories with their index status, without loading any index.
use super::{dto::WorkspaceRepository, error::RepositoryError, registry::RepositoryState};

pub fn workspace_overview(
    state: &RepositoryState,
    workspace: &str,
) -> Result<Vec<WorkspaceRepository>, RepositoryError> {
    let repos = state.directory().repositories(workspace)?;
    Ok(repos
        .iter()
        .map(|repo| {
            let entry = state.peek(&repo.root);
            let snapshot = entry.as_ref().and_then(|e| e.snapshot().ok());
            WorkspaceRepository {
                id: repo.id.clone(),
                name: repo.name.clone(),
                path: if repo.relative.is_empty() {
                    ".".to_owned()
                } else {
                    repo.relative.clone()
                },
                kind: repo.kind.clone(),
                branch: repo.branch.clone(),
                indexed: snapshot.is_some(),
                built_at_ms: entry.as_ref().and_then(|e| e.built_at_ms()),
                files: snapshot.map_or(0, |s| s.imports.files.len()),
            }
        })
        .collect())
}
