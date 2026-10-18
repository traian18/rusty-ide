//! Tauri commands for the architecture canvas. Each is a thin wrapper over [`Entry`], which stays
//! callable (and unit-testable) without a Tauri runtime.
use harness_findings::{FindingExplanation, FindingsPage};
use harness_workspace::dependency_groups::{
    GraphProjection, GroupAssignment, GroupOverview, MemberPage,
};
use harness_workspace::import_graph::ImportPage;
use tauri::{AppHandle, Manager, State};

use super::{dto::*, error::RepositoryError, persisted_state, registry::RepositoryState};

/// Runs `work` on a blocking thread, so a long computation never stalls the window.
async fn off_ui<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, RepositoryError> + Send + 'static,
) -> Result<T, RepositoryError> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| RepositoryError::new("internal", error.to_string()))?
}

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
    let entry = state.entry(&root)?;
    // Without saved storage (tests) a refresh is a plain rebuild; with it, a refresh is an analysis
    // job: it shows in the bubble, can be stopped there, and saves what it builds.
    if entry.storage.is_none() {
        return entry.refresh(include_git).await;
    }
    state.run_analysis(entry.clone()).await?;
    entry.current_response()
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

/// `repo_context` for an agent, for the repository the call is about: refreshes first when nothing
/// has been built, and once more when the answer says the target changed since the snapshot,
/// because an agent cannot refresh by itself.
#[tauri::command]
pub async fn repository_context(
    state: State<'_, RepositoryState>,
    root: String,
    active_repository: Option<String>,
    arguments: serde_json::Value,
) -> Result<serde_json::Value, RepositoryError> {
    super::routing::run_tool(
        &state,
        &root,
        active_repository.as_deref(),
        "repo_context",
        arguments,
    )
    .await
}

/// One of the host's agent tools (`repo_overview`, `repo_health`, `repo_risk`, `repo_symbol`).
#[tauri::command]
pub async fn repository_agent_tool(
    state: State<'_, RepositoryState>,
    root: String,
    active_repository: Option<String>,
    tool: String,
    arguments: serde_json::Value,
) -> Result<serde_json::Value, RepositoryError> {
    if !super::agent_tools::HOST_TOOLS.contains(&tool.as_str()) {
        return Err(RepositoryError::invalid(format!(
            "{tool} is not a repository agent tool"
        )));
    }
    super::routing::run_tool(
        &state,
        &root,
        active_repository.as_deref(),
        &tool,
        arguments,
    )
    .await
}

/// `repo_wiki` for an agent (the same tool the engine exposes).
#[tauri::command]
pub async fn repository_wiki_tool(
    state: State<'_, RepositoryState>,
    root: String,
    active_repository: Option<String>,
    arguments: serde_json::Value,
) -> Result<serde_json::Value, RepositoryError> {
    super::routing::run_tool(
        &state,
        &root,
        active_repository.as_deref(),
        "repo_wiki",
        arguments,
    )
    .await
}

/// The repositories of a workspace folder with whether each has an index loaded. Never loads one.
#[tauri::command]
pub fn repository_workspace_overview(
    state: State<'_, RepositoryState>,
    root: String,
) -> Result<Vec<super::dto::WorkspaceRepository>, RepositoryError> {
    super::overview::workspace_overview(&state, &root)
}

#[tauri::command]
pub async fn repository_wiki_page(
    state: State<'_, RepositoryState>,
    root: String,
    id: String,
) -> Result<harness_repository_wiki::Page, RepositoryError> {
    let entry = state.entry(&root)?;
    off_ui(move || entry.wiki_page(&id)).await
}

#[tauri::command]
pub async fn repository_wiki_children(
    state: State<'_, RepositoryState>,
    root: String,
    id: String,
) -> Result<Vec<harness_repository_wiki::TreeEntry>, RepositoryError> {
    let entry = state.entry(&root)?;
    off_ui(move || entry.wiki_children(&id)).await
}

#[tauri::command]
pub async fn repository_architecture(
    state: State<'_, RepositoryState>,
    root: String,
    request: LevelRequest,
) -> Result<LevelView, RepositoryError> {
    let entry = state.entry(&root)?;
    off_ui(move || entry.architecture_level(request)).await
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

fn documentation_file(
    app: &AppHandle,
    state: &RepositoryState,
    root: &str,
) -> Result<std::path::PathBuf, RepositoryError> {
    let entry = state.entry(root)?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| RepositoryError::new("io_error", error.to_string()))?;
    Ok(super::written::store_path(&data_dir, entry.root()))
}

/// The pages that can be written for a repository, what writing them would cost, and how current
/// the written ones are. Spends nothing.
#[tauri::command]
pub async fn repository_documentation_plan(
    app: AppHandle,
    state: State<'_, RepositoryState>,
    root: String,
) -> Result<super::written::DocumentationPlan, RepositoryError> {
    let store = documentation_file(&app, &state, &root)?;
    let entry = state.entry(&root)?;
    off_ui(move || entry.documentation_plan(&store)).await
}

/// What a model is asked to write one page from.
#[tauri::command]
pub async fn repository_documentation_brief(
    app: AppHandle,
    state: State<'_, RepositoryState>,
    root: String,
    id: String,
) -> Result<super::written::BriefView, RepositoryError> {
    let store = documentation_file(&app, &state, &root)?;
    let entry = state.entry(&root)?;
    off_ui(move || entry.documentation_brief(&store, &id)).await
}

/// Checks a model's answer against the sources it was given and stores what holds up.
#[tauri::command]
pub async fn repository_documentation_save(
    app: AppHandle,
    state: State<'_, RepositoryState>,
    root: String,
    id: String,
    markdown: String,
    model: String,
) -> Result<super::written::WrittenView, RepositoryError> {
    let store = documentation_file(&app, &state, &root)?;
    let entry = state.entry(&root)?;
    off_ui(move || entry.documentation_save(&store, &id, &markdown, &model)).await
}

#[tauri::command]
pub async fn repository_documentation_page(
    app: AppHandle,
    state: State<'_, RepositoryState>,
    root: String,
    id: String,
) -> Result<Option<super::written::WrittenView>, RepositoryError> {
    let store = documentation_file(&app, &state, &root)?;
    let entry = state.entry(&root)?;
    off_ui(move || entry.documentation_page(&store, &id)).await
}

#[tauri::command]
pub fn repository_documentation_settings(
    app: AppHandle,
    state: State<'_, RepositoryState>,
    root: String,
) -> Result<super::written::DocumentationSettings, RepositoryError> {
    super::written::documentation_settings(&documentation_file(&app, &state, &root)?)
}

#[tauri::command]
pub fn repository_documentation_set_settings(
    app: AppHandle,
    state: State<'_, RepositoryState>,
    root: String,
    settings: super::written::DocumentationSettings,
) -> Result<(), RepositoryError> {
    super::written::set_documentation_settings(&documentation_file(&app, &state, &root)?, settings)
}

/// One level of the files map.
#[tauri::command]
pub async fn repository_dashboard_map(
    state: State<'_, RepositoryState>,
    root: String,
    path: String,
) -> Result<super::dashboard::model::MapLevel, RepositoryError> {
    let entry = state.entry(&root)?;
    off_ui(move || entry.dashboard_map(&path)).await
}

/// Every file at once, for the whole-project map.
#[tauri::command]
pub async fn repository_dashboard_all_files(
    state: State<'_, RepositoryState>,
    root: String,
) -> Result<super::dashboard::model::MapFiles, RepositoryError> {
    let entry = state.entry(&root)?;
    off_ui(move || entry.dashboard_all_files()).await
}

/// The files table: filtered, sorted, paged.
#[tauri::command]
pub async fn repository_dashboard_files(
    state: State<'_, RepositoryState>,
    root: String,
    query: super::dashboard::model::FilesQuery,
) -> Result<super::dashboard::model::FilesPage, RepositoryError> {
    let entry = state.entry(&root)?;
    off_ui(move || entry.dashboard_files(&query)).await
}

/// One file for the shared drawer.
#[tauri::command]
pub async fn repository_dashboard_file(
    state: State<'_, RepositoryState>,
    root: String,
    file: String,
) -> Result<super::dashboard::model::FileDetail, RepositoryError> {
    let entry = state.entry(&root)?;
    off_ui(move || entry.dashboard_file(&file)).await
}

/// The text "Copy fix prompt" copies: for a file, or one of its findings.
#[tauri::command]
pub async fn repository_dashboard_prompt(
    state: State<'_, RepositoryState>,
    root: String,
    file: String,
    finding: Option<String>,
) -> Result<String, RepositoryError> {
    let entry = state.entry(&root)?;
    off_ui(move || entry.dashboard_prompt(&file, finding.as_deref())).await
}

/// The Code Health page: repository numbers, files worst first, detectors, folders, self-check.
#[tauri::command]
pub async fn repository_code_health(
    state: State<'_, RepositoryState>,
    root: String,
) -> Result<super::health::model::HealthReport, RepositoryError> {
    let entry = state.entry(&root)?;
    off_ui(move || entry.code_health()).await
}

/// One file's code health for the drawer.
#[tauri::command]
pub async fn repository_code_health_file(
    state: State<'_, RepositoryState>,
    root: String,
    path: String,
) -> Result<super::health::model::HealthFileDetail, RepositoryError> {
    let entry = state.entry(&root)?;
    off_ui(move || entry.code_health_file(&path)).await
}

/// "Copy fix prompt" for a file's code health issues, or one of them.
#[tauri::command]
pub async fn repository_code_health_prompt(
    state: State<'_, RepositoryState>,
    root: String,
    path: String,
    finding: Option<String>,
) -> Result<String, RepositoryError> {
    let entry = state.entry(&root)?;
    off_ui(move || entry.code_health_prompt(&path, finding.as_deref())).await
}

/// Everything running in the background, for the process bubble.
#[tauri::command]
pub fn repository_jobs(state: State<'_, RepositoryState>) -> Vec<super::jobs::Job> {
    state.jobs().list()
}

/// The bubble's ×: stops a running job, or removes a finished one.
#[tauri::command]
pub fn repository_job_cancel(state: State<'_, RepositoryState>, id: u64) {
    if !state.jobs().cancel(id) {
        state.jobs().dismiss(id);
    }
}

/// A job the frontend runs (documentation), registered so it shows in the bubble and can be
/// stopped from there; the frontend watches the job list for its cancellation.
#[tauri::command]
pub fn repository_job_start(state: State<'_, RepositoryState>, root: String, label: String) -> u64 {
    state
        .jobs()
        .start(super::jobs::JobKind::Documentation, &root, &label)
        .0
}

#[tauri::command]
pub fn repository_job_progress(
    state: State<'_, RepositoryState>,
    id: u64,
    done: Option<u32>,
    total: Option<u32>,
    detail: Option<String>,
) {
    state.jobs().progress(id, done, total, detail.as_deref());
}

#[tauri::command]
pub fn repository_job_finish(
    state: State<'_, RepositoryState>,
    id: u64,
    failed: bool,
    message: Option<String>,
) {
    let outcome = if failed {
        super::jobs::JobState::Failed
    } else {
        super::jobs::JobState::Finished
    };
    state.jobs().finish(id, outcome, message.as_deref());
}

/// Whether analysis runs by itself after changes (the "Index in background" switch).
#[tauri::command]
pub fn repository_set_background(state: State<'_, RepositoryState>, enabled: bool) {
    state.set_background(enabled);
}

/// After a commit: the files it changed and the written pages built from them.
#[tauri::command]
pub async fn repository_documentation_after_commit(
    app: AppHandle,
    state: State<'_, RepositoryState>,
    root: String,
) -> Result<super::written::CommitPages, RepositoryError> {
    let store = documentation_file(&app, &state, &root)?;
    let entry = state.entry(&root)?;
    off_ui(move || {
        let (commit, files) = super::written::files_in_head(entry.root())?;
        let pages = super::written::pages_touching(&store, &files)?
            .into_iter()
            .map(|(id, title)| super::written::PageRef { id, title })
            .collect();
        Ok(super::written::CommitPages {
            commit,
            files,
            pages,
        })
    })
    .await
}

/// Documentation pages the user agreed to update and not yet written, with the model to use;
/// kept on disk so a restart picks them up.
#[tauri::command]
pub fn repository_documentation_pending(
    state: State<'_, RepositoryState>,
    root: String,
) -> Result<super::written::PendingDocumentation, RepositoryError> {
    let entry = state.entry(&root)?;
    let pending = entry
        .storage
        .as_ref()
        .map(|s| s.pending())
        .unwrap_or_default();
    Ok(super::written::PendingDocumentation {
        pages: pending.documentation,
        model: pending.documentation_model,
    })
}

#[tauri::command]
pub fn repository_documentation_queue(
    state: State<'_, RepositoryState>,
    root: String,
    pages: Vec<String>,
    model: Option<String>,
) -> Result<(), RepositoryError> {
    let entry = state.entry(&root)?;
    if let Some(storage) = &entry.storage {
        storage.update_pending(|p| {
            for page in pages {
                if !p.documentation.contains(&page) {
                    p.documentation.push(page);
                }
            }
            if model.is_some() {
                p.documentation_model = model;
            }
        });
    }
    Ok(())
}

#[tauri::command]
pub fn repository_documentation_done(
    state: State<'_, RepositoryState>,
    root: String,
    page: String,
) -> Result<(), RepositoryError> {
    let entry = state.entry(&root)?;
    if let Some(storage) = &entry.storage {
        storage.update_pending(|p| p.documentation.retain(|id| *id != page));
    }
    Ok(())
}
