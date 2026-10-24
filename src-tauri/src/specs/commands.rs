//! Tauri commands for the Specs page. Each resolves the repository folder, then calls into
//! `harness-specs` on a blocking thread.
use std::path::{Path, PathBuf};

use harness_specs::{
    archive, context, export, import,
    layout::Layout,
    overview as scan, parse, plan,
    progress::{self, ProgressInput, ProgressRecorded},
    record::{self, DocumentInput, Recorded, Step},
    scaffold, ChangeRequest, FsStore, SpecStore, SpecsOverview,
};
use serde::Serialize;

use super::branch::{self, BranchOutcome};
use crate::repository::error::RepositoryError;

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, RepositoryError> + Send + 'static,
) -> Result<T, RepositoryError> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| RepositoryError::new("internal", error.to_string()))?
}

fn folder(root: &str) -> Result<PathBuf, RepositoryError> {
    let path = Path::new(root);
    if path.is_dir() {
        Ok(path.to_path_buf())
    } else {
        Err(RepositoryError::invalid(format!("{root} is not a folder")))
    }
}

fn spec_error(error: harness_specs::SpecError) -> RepositoryError {
    RepositoryError::new("io_error", error.message)
}

/// Everything under the specs root: project, capabilities, changes with progress, archive.
#[tauri::command]
pub async fn specs_overview(root: String) -> Result<SpecsOverview, RepositoryError> {
    blocking(move || Ok(scan(&FsStore::new(folder(&root)?)))).await
}

/// One document under the specs root, by path relative to the repository.
#[tauri::command]
pub async fn specs_document(root: String, path: String) -> Result<Option<String>, RepositoryError> {
    blocking(move || {
        let store = FsStore::new(folder(&root)?);
        if !Layout::of(&store).contains(&path) {
            return Err(RepositoryError::invalid(format!(
                "{path} is not inside the specs folder"
            )));
        }
        Ok(store.read(&path))
    })
    .await
}

/// Writes `README.md` and `project.md` where they are missing; returns what it created.
#[tauri::command]
pub async fn specs_init(root: String) -> Result<Vec<String>, RepositoryError> {
    blocking(move || scaffold::init(&FsStore::new(folder(&root)?)).map_err(spec_error)).await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedChange {
    pub dir: String,
    pub files: Vec<String>,
    /// `None` when no branch was asked for.
    pub branch: Option<BranchOutcome>,
}

/// Creates the next numbered change from templates. With `branch`, it first creates and switches
/// to `spec/<folder>` so the files land on it; a branch that cannot be made does not stop the
/// change, and the outcome says why.
#[tauri::command]
pub async fn specs_change_create(
    root: String,
    title: String,
    description: String,
    date: String,
    branch: bool,
) -> Result<CreatedChange, RepositoryError> {
    blocking(move || {
        let folder = folder(&root)?;
        if title.trim().is_empty() {
            return Err(RepositoryError::invalid("a change needs a title"));
        }
        if !plain_date(&date) {
            return Err(RepositoryError::invalid("the date must be YYYY-MM-DD"));
        }
        let store = FsStore::new(&folder);
        let plan = scaffold::plan_change(&store, &title);
        let outcome = branch.then(|| branch::create_and_switch(&folder, &plan.branch));
        let created = match &outcome {
            Some(BranchOutcome::Created { name }) => Some(name.as_str()),
            _ => None,
        };
        let request = ChangeRequest {
            title: &title,
            description: &description,
            date: &date,
            branch: created,
        };
        let files = scaffold::create_change(&store, &plan, &request).map_err(spec_error)?;
        Ok(CreatedChange {
            dir: plan.dir,
            files,
            branch: outcome,
        })
    })
    .await
}

fn plain_date(date: &str) -> bool {
    let bytes = date.as_bytes();
    bytes.len() == 10
        && bytes.iter().enumerate().all(|(i, b)| {
            if i == 4 || i == 7 {
                *b == b'-'
            } else {
                b.is_ascii_digit()
            }
        })
}

/// The tasks of one change, as `tasks.md` lists them. No file is no tasks.
#[tauri::command]
pub async fn specs_tasks(
    root: String,
    change: String,
) -> Result<Vec<harness_specs::model::Task>, RepositoryError> {
    blocking(move || {
        let store = FsStore::new(folder(&root)?);
        let path = format!("{}/tasks.md", Layout::of(&store).change(&change));
        if !Layout::of(&store).contains(&path) {
            return Err(RepositoryError::invalid(format!(
                "{change} is not a change folder"
            )));
        }
        Ok(store
            .read(&path)
            .map(|text| parse::tasks::parse(&text).tasks)
            .unwrap_or_default())
    })
    .await
}

/// The text a Specify or Plan run starts from, composed from the files at this moment.
#[tauri::command]
pub async fn specs_context(
    root: String,
    change: String,
    step: Step,
) -> Result<String, RepositoryError> {
    blocking(move || {
        let store = FsStore::new(folder(&root)?);
        // Start specs works on the whole repository, not on one change.
        if !matches!(step, Step::Start | Step::Capability)
            && !store.dirs(&Layout::of(&store).changes()).contains(&change)
        {
            return Err(RepositoryError::invalid(format!(
                "{change} is not a change"
            )));
        }
        Ok(context::compose(&store, &change, step))
    })
    .await
}

/// Writes what a Specify or Plan run produced into the change and moves its status on.
#[tauri::command]
pub async fn specs_record(
    root: String,
    change: String,
    step: Step,
    documents: Vec<DocumentInput>,
    date: String,
) -> Result<Recorded, RepositoryError> {
    blocking(move || {
        if !plain_date(&date) {
            return Err(RepositoryError::invalid("the date must be YYYY-MM-DD"));
        }
        record::record(
            &FsStore::new(folder(&root)?),
            &change,
            step,
            &documents,
            &date,
        )
        .map_err(spec_error)
    })
    .await
}

/// The plans an Implement run is started with: the whole spec for verification, and the unticked
/// tasks for the queue.
#[tauri::command]
pub async fn specs_queue_plan(
    root: String,
    change: String,
) -> Result<plan::QueuePlans, RepositoryError> {
    blocking(move || {
        let store = FsStore::new(folder(&root)?);
        if !store.dirs(&Layout::of(&store).changes()).contains(&change) {
            return Err(RepositoryError::invalid(format!(
                "{change} is not a change"
            )));
        }
        plan::queue_plans(&store, &change).map_err(spec_error)
    })
    .await
}

/// Ticks the tasks an Implement run finished, writes their documents and `verification.md`, and
/// moves the status on. Called with whatever the run got to, also when it failed or was stopped.
#[tauri::command]
pub async fn specs_progress(
    root: String,
    change: String,
    progress: ProgressInput,
    date: String,
) -> Result<ProgressRecorded, RepositoryError> {
    blocking(move || {
        if !plain_date(&date) {
            return Err(RepositoryError::invalid("the date must be YYYY-MM-DD"));
        }
        progress::record_progress(&FsStore::new(folder(&root)?), &change, &progress, &date)
            .map_err(spec_error)
    })
    .await
}

/// Merges a finished change into the capability specs and moves it to the archive. `force`
/// archives a change that is not done or has unticked tasks; a requirement that cannot be merged
/// always stops the archive, and nothing is written then.
#[tauri::command]
pub async fn specs_archive(
    root: String,
    change: String,
    date: String,
    force: bool,
) -> Result<archive::Archived, RepositoryError> {
    blocking(move || {
        if !plain_date(&date) {
            return Err(RepositoryError::invalid("the date must be YYYY-MM-DD"));
        }
        archive::archive(&FsStore::new(folder(&root)?), &change, &date, force).map_err(spec_error)
    })
    .await
}

/// OpenSpec and Spec Kit folders found in the repository.
#[tauri::command]
pub async fn specs_foreign(root: String) -> Result<Vec<import::Detected>, RepositoryError> {
    blocking(move || Ok(import::detect(&FsStore::new(folder(&root)?)))).await
}

/// Converts an OpenSpec or Spec Kit folder into this layout. The source stays where it is and
/// nothing that exists here is overwritten.
#[tauri::command]
pub async fn specs_import(
    root: String,
    source: import::Source,
    date: String,
) -> Result<import::ImportReport, RepositoryError> {
    blocking(move || {
        if !plain_date(&date) {
            return Err(RepositoryError::invalid("the date must be YYYY-MM-DD"));
        }
        import::import(&FsStore::new(folder(&root)?), source, &date).map_err(spec_error)
    })
    .await
}

/// Writes these specs in OpenSpec's or Spec Kit's layout. The specs here stay the source and
/// nothing that exists in the target is overwritten.
#[tauri::command]
pub async fn specs_export(
    root: String,
    target: import::Source,
    date: String,
) -> Result<export::ExportReport, RepositoryError> {
    blocking(move || {
        if !plain_date(&date) {
            return Err(RepositoryError::invalid("the date must be YYYY-MM-DD"));
        }
        export::export(&FsStore::new(folder(&root)?), target, &date).map_err(spec_error)
    })
    .await
}

/// Ticks or unticks one task in a change's `tasks.md`.
#[tauri::command]
pub async fn specs_task_tick(
    root: String,
    change: String,
    task: String,
    done: bool,
) -> Result<(), RepositoryError> {
    blocking(move || {
        let store = FsStore::new(folder(&root)?);
        let path = format!("{}/tasks.md", Layout::of(&store).change(&change));
        if !Layout::of(&store).contains(&path) {
            return Err(RepositoryError::invalid(format!(
                "{change} is not a change folder"
            )));
        }
        let text = store
            .read(&path)
            .ok_or_else(|| RepositoryError::new("not_found", format!("{path} does not exist")))?;
        let updated = parse::tasks::set_done(&text, &task, done)
            .ok_or_else(|| RepositoryError::new("not_found", format!("{task} is not in {path}")))?;
        store.write(&path, &updated).map_err(spec_error)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_are_plain() {
        assert!(plain_date("2026-10-23"));
        assert!(
            !plain_date("2026/10/23") && !plain_date("23-10-2026") && !plain_date("2026-10-2x")
        );
    }
}
