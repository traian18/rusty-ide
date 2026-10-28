//! Tauri commands for goal loops. The tab passes `now` (an ISO timestamp) so the host needs no
//! clock of its own and tests stay deterministic.
use std::path::{Path, PathBuf};

use harness_goals::{
    decide, pass_prompt, record, status_text, Budget, CheckOutcome, Decision, Goal, GoalStatus,
    Measurement, PassReport, Targets,
};
use harness_runtime::workspace_snapshot::{take, undo_to};
use serde::{Deserialize, Serialize};
use tauri::State;

use super::store;
use crate::repository::{
    error::RepositoryError,
    goal_measure::{default_scope, measure, unknown_items},
    RepositoryState,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalRequest {
    pub instruction: String,
    #[serde(default)]
    pub scope: Vec<String>,
    /// The scope in words (`scope="..."`).
    #[serde(default)]
    pub scope_note: Option<String>,
    #[serde(default)]
    pub targets: Targets,
    #[serde(default)]
    pub budget: Option<Budget>,
    #[serde(default)]
    pub keep_best: Option<bool>,
    #[serde(default)]
    pub chat_id: Option<String>,
}

/// The goal after a command, with what the tab shows and sends next.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalStep {
    pub goal: Goal,
    /// The next pass's message, while the goal runs.
    pub prompt: Option<String>,
    /// The goal in a few lines.
    pub status: String,
    pub decision: Option<Decision>,
    /// Files put back as they were when the pass was undone.
    pub undone: Vec<String>,
}

fn folder(root: &str) -> Result<PathBuf, RepositoryError> {
    let path = Path::new(root);
    if path.is_dir() {
        Ok(path.to_path_buf())
    } else {
        Err(RepositoryError::invalid(format!("{root} is not a folder")))
    }
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, RepositoryError> + Send + 'static,
) -> Result<T, RepositoryError> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| RepositoryError::new("internal", error.to_string()))?
}

/// Records the workspace before the next pass, so a pass that makes things worse can be undone.
async fn checkpoint(root: &Path, goal: &Goal) -> Result<(), RepositoryError> {
    let (path, id) = (root.to_path_buf(), goal.id.clone());
    let label = format!("goal/{}/pass-{}", goal.id, goal.passes + 1);
    blocking(move || store::save_checkpoint(&path, &id, &take(&path, &label))).await
}

fn step(goal: Goal, decision: Option<Decision>, undone: Vec<String>) -> GoalStep {
    let current = goal.last.as_ref().or(goal.baseline.as_ref());
    let prompt = (goal.status == GoalStatus::Running)
        .then(|| current.map(|m| pass_prompt(&goal, m)))
        .flatten();
    GoalStep {
        status: status_text(&goal),
        prompt,
        decision,
        undone,
        goal,
    }
}

/// The scope item for "the files the passes change".
const CHANGED: &str = "changed";

fn new_id(now: &str) -> String {
    let digits: String = now.chars().filter(char::is_ascii_digit).take(14).collect();
    let nonce = std::process::id() ^ (std::time::Instant::now().elapsed().subsec_nanos());
    format!("g-{digits}-{:04x}", nonce & 0xffff)
}

/// Starts a goal: measures where it stands, records the workspace, and returns the first pass.
/// Any goal still running in the same chat is paused first: a chat runs one goal at a time.
#[tauri::command]
pub async fn goal_create(
    state: State<'_, RepositoryState>,
    root: String,
    active_repository: Option<String>,
    request: GoalRequest,
    now: String,
) -> Result<GoalStep, RepositoryError> {
    let path = folder(&root)?;
    if request.instruction.trim().is_empty() {
        return Err(RepositoryError::invalid("a goal needs an instruction"));
    }
    for mut other in store::list(&path)? {
        if other.status == GoalStatus::Running && other.chat_id == request.chat_id {
            other.status = GoalStatus::Paused;
            other.reason = Some("Paused: a new goal started in this chat.".into());
            store::save(&path, &other)?;
        }
    }
    // `scope=changed`: measured on the files the passes change, which is an empty scope.
    let changed = request.scope.iter().any(|item| item == CHANGED);
    let mut scope: Vec<String> = request
        .scope
        .into_iter()
        .filter(|item| item != CHANGED)
        .collect();
    // Plain words that are not paths (`scope=The general health is ...`) were meant as the start
    // of the instruction; something that looks like a path but is not there is a mistake.
    let (words, unknown): (Vec<String>, Vec<String>) = unknown_items(&root, &scope)
        .into_iter()
        .partition(|item| !item.contains(['/', '.', '\\']));
    scope.retain(|item| !words.contains(item));
    let instruction = [words.join(" "), request.instruction.trim().to_owned()]
        .join(" ")
        .trim()
        .to_owned();
    let note = request
        .scope_note
        .map(|note| note.trim().to_owned())
        .filter(|note| !note.is_empty());
    if !unknown.is_empty() {
        return Err(RepositoryError::invalid(format!(
            "scope {} names no file, folder or glob in the workspace (scope= takes paths, like scope=rusty-core or scope=src/**/*.rs)",
            unknown.iter().map(|u| format!("'{u}'")).collect::<Vec<_>>().join(", ")
        )));
    }
    let mut goal = Goal::new(new_id(&now), instruction, now);
    goal.scope = scope;
    goal.scope_note = note;
    goal.targets = request.targets;
    if goal.scope.is_empty() && !changed && goal.targets.on_files() {
        let words = format!(
            "{} {}",
            goal.scope_note.as_deref().unwrap_or_default(),
            goal.instruction
        );
        let scope = default_scope(&state, &root, &words, active_repository.as_deref())?
            .ok_or_else(|| {
                RepositoryError::invalid(
                    "say which files the goal is measured on, with scope=<repository or folder>",
                )
            })?;
        goal.scope = vec![scope];
    }
    goal.budget = request.budget.unwrap_or_default();
    goal.keep_best = request.keep_best.unwrap_or(true);
    goal.chat_id = request.chat_id;
    goal.baseline = Some(
        measure(
            &state,
            &root,
            active_repository.as_deref(),
            &goal.scope,
            &[],
        )
        .await?,
    );
    let measured = goal.baseline.as_ref().map_or(0, |b| b.scored().count());
    if goal.targets.on_files() && !goal.scope.is_empty() && measured == 0 {
        return Err(RepositoryError::invalid(format!(
            "nothing in scope ({}) has a code health score, so the goal could not be measured",
            goal.scope.join(", ")
        )));
    }
    checkpoint(&path, &goal).await?;
    store::save(&path, &goal)?;
    Ok(step(goal, None, Vec::new()))
}

/// After a pass: measure, decide, undo a pass that made things worse, and say what comes next.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn goal_after_pass(
    state: State<'_, RepositoryState>,
    root: String,
    active_repository: Option<String>,
    id: String,
    report: PassReport,
    checks: Vec<CheckOutcome>,
    touched: Vec<String>,
    now: String,
) -> Result<GoalStep, RepositoryError> {
    let path = folder(&root)?;
    let mut goal = store::load(&path, &id)?;
    if goal.status != GoalStatus::Running {
        return Ok(step(goal, None, Vec::new()));
    }
    for file in touched {
        if !goal.touched.contains(&file) {
            goal.touched.push(file);
        }
    }
    let mut measured: Measurement = measure(
        &state,
        &root,
        active_repository.as_deref(),
        &goal.scope,
        &goal.touched,
    )
    .await?;
    measured.checks = checks;
    let decision = decide(&goal, &measured, &report);
    let mut undone = Vec::new();
    if decision.undo {
        if let Some(saved) = store::checkpoint(&path, &goal.id)? {
            let (workspace, label) = (
                path.clone(),
                format!("goal/{}/undone-{}", goal.id, goal.passes + 1),
            );
            undone = blocking(move || {
                undo_to(&workspace, &saved, &label)
                    .map(|u| u.files)
                    .map_err(|e| RepositoryError::new("undo_failed", e))
            })
            .await?;
        }
    }
    record(&mut goal, &decision, measured, &report, now);
    if goal.status == GoalStatus::Running && !decision.undo {
        checkpoint(&path, &goal).await?;
    }
    store::save(&path, &goal)?;
    Ok(step(goal, Some(decision), undone))
}

/// `pause` (with the reason to show, by default that the user paused it), `resume` (a fresh pass
/// budget, measured again) or `clear` (deletes the goal).
#[tauri::command]
pub async fn goal_control(
    state: State<'_, RepositoryState>,
    root: String,
    active_repository: Option<String>,
    id: String,
    action: String,
    reason: Option<String>,
    now: String,
) -> Result<GoalStep, RepositoryError> {
    let path = folder(&root)?;
    let mut goal = store::load(&path, &id)?;
    match action.as_str() {
        "pause" => {
            goal.status = GoalStatus::Paused;
            goal.reason = Some(reason.unwrap_or_else(|| "Paused by you.".into()));
            goal.updated_at = now;
        }
        "resume" => {
            goal.resume(now);
            let mut measured = measure(
                &state,
                &root,
                active_repository.as_deref(),
                &goal.scope,
                &goal.touched,
            )
            .await?;
            // Checks are only known from passes; keep the last ones so the prompt still lists them.
            measured.checks = goal
                .last
                .as_ref()
                .map(|m| m.checks.clone())
                .unwrap_or_default();
            goal.last = Some(measured);
            checkpoint(&path, &goal).await?;
        }
        "clear" => {
            store::delete(&path, &goal.id)?;
            goal.status = GoalStatus::Cleared;
            goal.updated_at = now;
            return Ok(step(goal, None, Vec::new()));
        }
        other => {
            return Err(RepositoryError::invalid(format!(
                "'{other}' is not pause, resume or clear"
            )))
        }
    }
    store::save(&path, &goal)?;
    Ok(step(goal, None, Vec::new()))
}

/// The workspace's goals, the most recently updated first.
#[tauri::command]
pub async fn goal_list(root: String) -> Result<Vec<GoalStep>, RepositoryError> {
    let path = folder(&root)?;
    blocking(move || {
        Ok(store::list(&path)?
            .into_iter()
            .map(|g| step(g, None, Vec::new()))
            .collect())
    })
    .await
}
