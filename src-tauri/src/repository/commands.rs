//! Tauri commands for the architecture canvas. Each is a thin wrapper over [`Entry`], which stays
//! callable (and unit-testable) without a Tauri runtime.
use harness_findings::{FindingExplanation, FindingsPage};
use harness_workspace::dependency_groups::{
    GraphProjection, GroupAssignment, GroupOverview, MemberPage,
};
use harness_workspace::import_graph::ImportPage;
use tauri::{AppHandle, Manager, State};

use super::{dto::*, error::RepositoryError, persisted_state, registry::RepositoryState};

#[tauri::command]
pub async fn repository_open(
    state: State<'_, RepositoryState>,
    root: String,
) -> Result<OpenResponse, RepositoryError> {
    Ok(state.entry(&root)?.open_response())
}

#[tauri::command]
pub async fn repository_refresh(
    state: State<'_, RepositoryState>,
    root: String,
    include_git: bool,
) -> Result<RefreshResponse, RepositoryError> {
    state.entry(&root)?.refresh(include_git).await
}

#[tauri::command]
pub fn repository_cancel(
    state: State<'_, RepositoryState>,
    root: String,
) -> Result<(), RepositoryError> {
    state.entry(&root)?.cancel_refresh();
    Ok(())
}

#[tauri::command]
pub fn repository_close(state: State<'_, RepositoryState>, root: String) {
    state.close(&root);
}

#[tauri::command]
pub fn repository_overview(
    state: State<'_, RepositoryState>,
    root: String,
    request: OverviewRequest,
) -> Result<GroupOverview, RepositoryError> {
    state.entry(&root)?.overview(request)
}

#[tauri::command]
pub fn repository_architecture(
    state: State<'_, RepositoryState>,
    root: String,
    request: LevelRequest,
) -> Result<LevelView, RepositoryError> {
    state.entry(&root)?.architecture_level(request)
}

#[tauri::command]
pub fn repository_framework_relations(
    state: State<'_, RepositoryState>,
    root: String,
    request: FrameworkRequest,
) -> Result<harness_workspace::framework_relations::FrameworkPage, RepositoryError> {
    state.entry(&root)?.framework_relations(request)
}

#[tauri::command]
pub fn repository_group_members(
    state: State<'_, RepositoryState>,
    root: String,
    request: MembersRequest,
) -> Result<MemberPage, RepositoryError> {
    state.entry(&root)?.members(request)
}

#[tauri::command]
pub fn repository_group_graph(
    state: State<'_, RepositoryState>,
    root: String,
    request: GroupGraphRequest,
) -> Result<GroupGraph, RepositoryError> {
    state.entry(&root)?.group_graph(request)
}

#[tauri::command]
pub fn repository_neighbourhood(
    state: State<'_, RepositoryState>,
    root: String,
    request: NeighbourhoodRequest,
) -> Result<GraphProjection, RepositoryError> {
    state.entry(&root)?.neighbourhood(request)
}

#[tauri::command]
pub fn repository_edges(
    state: State<'_, RepositoryState>,
    root: String,
    request: EdgesRequest,
) -> Result<ImportPage, RepositoryError> {
    state.entry(&root)?.edges(request)
}

#[tauri::command]
pub fn repository_groups_of(
    state: State<'_, RepositoryState>,
    root: String,
    file: String,
) -> Result<Vec<GroupAssignment>, RepositoryError> {
    state.entry(&root)?.groups_of(&file)
}

#[tauri::command]
pub fn repository_findings(
    state: State<'_, RepositoryState>,
    root: String,
    request: FindingsRequest,
) -> Result<FindingsPage, RepositoryError> {
    state.entry(&root)?.findings(request)
}

#[tauri::command]
pub fn repository_finding_explain(
    state: State<'_, RepositoryState>,
    root: String,
    finding: String,
) -> Result<FindingExplanation, RepositoryError> {
    state.entry(&root)?.finding_explain(&finding)
}

#[tauri::command]
pub fn repository_finding_badges(
    state: State<'_, RepositoryState>,
    root: String,
) -> Result<FindingBadges, RepositoryError> {
    state.entry(&root)?.finding_badges()
}

#[tauri::command]
pub fn repository_git_file(
    state: State<'_, RepositoryState>,
    root: String,
    file: String,
) -> Result<Option<GitFileFacts>, RepositoryError> {
    state.entry(&root)?.git_file(&file)
}

#[tauri::command]
pub fn repository_nodes_exist(
    state: State<'_, RepositoryState>,
    root: String,
    request: NodesExistRequest,
) -> Result<NodesExist, RepositoryError> {
    state.entry(&root)?.nodes_exist(request)
}

#[tauri::command]
pub fn repository_freshness(
    state: State<'_, RepositoryState>,
    root: String,
) -> Result<Freshness, RepositoryError> {
    state.entry(&root)?.freshness()
}

fn state_file(
    app: &AppHandle,
    state: &RepositoryState,
    root: &str,
) -> Result<std::path::PathBuf, RepositoryError> {
    let entry = state.entry(root)?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| RepositoryError::new("io_error", error.to_string()))?;
    Ok(persisted_state::state_path(&data_dir, entry.root()))
}

#[tauri::command]
pub fn repository_state_load(
    app: AppHandle,
    state: State<'_, RepositoryState>,
    root: String,
) -> Result<Option<serde_json::Value>, RepositoryError> {
    persisted_state::load(&state_file(&app, &state, &root)?)
}

#[tauri::command]
pub fn repository_state_save(
    app: AppHandle,
    state: State<'_, RepositoryState>,
    root: String,
    document: serde_json::Value,
) -> Result<(), RepositoryError> {
    persisted_state::save(&state_file(&app, &state, &root)?, &document)
}
