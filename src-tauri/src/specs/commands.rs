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

pub(super) async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, RepositoryError> + Send + 'static,
) -> Result<T, RepositoryError> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| RepositoryError::new("internal", error.to_string()))?
}

pub(super) fn folder(root: &str) -> Result<PathBuf, RepositoryError> {
    let path = Path::new(root);
    if path.is_dir() {
        Ok(path.to_path_buf())
    } else {
        Err(RepositoryError::invalid(format!("{root} is not a folder")))
    }
}

pub(super) fn spec_error(error: harness_specs::SpecError) -> RepositoryError {
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
    /// A workspace change's branch, per repository it was asked for in.
    pub repository_branches: Vec<RepositoryBranch>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryBranch {
    /// The repository's folder, relative to the workspace.
    pub repository: String,
    pub outcome: BranchOutcome,
}

/// Creates the next numbered change from templates. With `branch`, it first creates and switches
/// to `branch_name` (default `spec/<folder>`) so the files land on it; a branch that cannot be
/// made does not stop the change, and the outcome says why. A workspace change (its specs live
/// outside every repository) makes the branch in `repositories` instead of in `root`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn specs_change_create(
    root: String,
    title: String,
    description: String,
    date: String,
    branch: bool,
    branch_name: Option<String>,
    repositories: Option<Vec<String>>,
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
        let name = branch::chosen_name(branch_name.as_deref(), &plan.branch);
        let repositories = repositories.unwrap_or_default();
        let mut repository_branches = Vec::new();
        let outcome = if !branch {
            None
        } else if repositories.is_empty() {
            Some(branch::create_and_switch(&folder, &name))
        } else {
            for repository in &repositories {
                let path = Path::new(repository);
                repository_branches.push(RepositoryBranch {
                    repository: path
                        .strip_prefix(&folder)
                        .unwrap_or(path)
                        .to_string_lossy()
                        .into_owned(),
                    outcome: branch::create_and_switch(path, &name),
                });
            }
            Some(summary(&repository_branches, &name))
        };
        let created = match &outcome {
            Some(BranchOutcome::Created { name }) => Some(name.as_str()),
            _ => None,
        };
        let request = ChangeRequest {
            title: &title,
            description: &description,
            date: &date,
            branch: created,
            linked: None,
        };
        let files = scaffold::create_change(&store, &plan, &request).map_err(spec_error)?;
        Ok(CreatedChange {
            dir: plan.dir,
            files,
            branch: outcome,
            repository_branches,
        })
    })
    .await
}

/// One outcome for a branch made in several repositories: created when any repository has it.
fn summary(branches: &[RepositoryBranch], name: &str) -> BranchOutcome {
    if branches
        .iter()
        .any(|b| matches!(b.outcome, BranchOutcome::Created { .. }))
    {
        return BranchOutcome::Created {
            name: name.to_owned(),
        };
    }
    let reasons: Vec<String> = branches
        .iter()
        .filter_map(|b| match &b.outcome {
            BranchOutcome::Skipped { reason } => Some(format!("{}: {reason}", b.repository)),
            BranchOutcome::Created { .. } => None,
        })
        .collect();
    BranchOutcome::Skipped {
        reason: reasons.join("; "),
    }
}

pub(super) fn plain_date(date: &str) -> bool {
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

/// The text a Specify or Plan run starts from, composed from the files at this moment. With the
/// `workspace` the run works in, it also says where the repository is in it and, for a linked
/// change, what the other parts are.
#[tauri::command]
pub async fn specs_context(
    root: String,
    change: String,
    step: Step,
    workspace: Option<String>,
) -> Result<String, RepositoryError> {
    blocking(move || {
        let repository = folder(&root)?;
        let store = FsStore::new(&repository);
        // Start specs works on the whole repository, not on one change.
        if !matches!(step, Step::Start | Step::Capability)
            && !store.dirs(&Layout::of(&store).changes()).contains(&change)
        {
            return Err(RepositoryError::invalid(format!(
                "{change} is not a change"
            )));
        }
        // Planning or building needs the spec of the change itself: a spec that is still the
        // empty template (a linked part nobody specified yet) has nothing to go on.
        if matches!(step, Step::Plan | Step::Implement) {
            let layout = Layout::of(&store);
            let spec = store.read(&format!("{}/spec.md", layout.change(&change)));
            if spec.as_deref().is_some_and(harness_specs::parse::spec::is_unwritten) {
                return Err(RepositoryError::invalid(format!(
                    "The spec of {change} in this repository is still the empty template, so there is nothing to plan or build from. Write it first: run Specify on this change."
                )));
            }
        }
        let place = super::linked::Place::of(workspace.as_deref(), &repository);
        Ok(format!(
            "{}{}{}",
            place.preamble(),
            context::compose(&store, &change, step),
            place.linked_context(&store, &change, step)
        ))
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

    #[tokio::test]
    async fn a_spec_that_is_still_the_template_cannot_be_planned_or_built() {
        let folder = tempfile::tempdir().unwrap();
        let change = folder.path().join("specs/changes/0001-dark");
        std::fs::create_dir_all(&change).unwrap();
        let root = folder.path().to_string_lossy().into_owned();
        std::fs::write(
            change.join("spec.md"),
            "# Dark\n\n## Requirements\n\n### R1: \nCapability: \n\n- C1: WHEN … THEN ….\n",
        )
        .unwrap();
        for step in [Step::Plan, Step::Implement] {
            let error = specs_context(root.clone(), "0001-dark".into(), step, None)
                .await
                .unwrap_err();
            assert!(
                error.message.contains("still the empty template"),
                "{error:?}"
            );
        }
        // Specify may start from the template: that is how it is written.
        assert!(
            specs_context(root.clone(), "0001-dark".into(), Step::Specify, None)
                .await
                .is_ok()
        );
        std::fs::write(
            change.join("spec.md"),
            "# Dark\n\n## Requirements\n\n### R1: Dark theme\n\n- C1: WHEN the user turns it on THEN the app is dark.\n",
        )
        .unwrap();
        assert!(specs_context(root, "0001-dark".into(), Step::Plan, None)
            .await
            .is_ok());
    }

    fn repository(parent: &Path, name: &str) -> PathBuf {
        let root = parent.join(name);
        std::fs::create_dir_all(&root).unwrap();
        let git = |args: &[&str]| {
            assert!(std::process::Command::new("git")
                .args(["-c", "user.name=t", "-c", "user.email=t@t"])
                .args(args)
                .current_dir(&root)
                .status()
                .unwrap()
                .success());
        };
        git(&["init", "-q"]);
        std::fs::write(root.join("a.txt"), "a").unwrap();
        git(&["add", "."]);
        git(&["commit", "-q", "-m", "first"]);
        root
    }

    #[tokio::test]
    async fn a_workspace_change_lives_in_the_rusty_folder_and_branches_its_repositories() {
        let workspace = tempfile::tempdir().unwrap();
        let ide = repository(workspace.path(), "ide");
        let core = repository(workspace.path(), "core");
        let path = |p: &Path| p.to_string_lossy().into_owned();
        super::super::workspace::specs_workspace_prepare(path(workspace.path()))
            .await
            .unwrap();
        let created = specs_change_create(
            path(workspace.path()),
            "Dark mode".into(),
            String::new(),
            "2026-10-26".into(),
            true,
            Some("feature/dark".into()),
            Some(vec![path(&ide), path(&core)]),
        )
        .await
        .unwrap();
        assert!(workspace
            .path()
            .join(".rusty/specs/changes")
            .join(&created.dir)
            .join("spec.md")
            .is_file());
        assert_eq!(
            created.branch,
            Some(BranchOutcome::Created {
                name: "feature/dark".into()
            })
        );
        let repositories: Vec<&str> = created
            .repository_branches
            .iter()
            .map(|b| b.repository.as_str())
            .collect();
        assert_eq!(repositories, ["ide", "core"]);
        let change = std::fs::read_to_string(
            workspace
                .path()
                .join(".rusty/specs/changes")
                .join(&created.dir)
                .join("change.md"),
        )
        .unwrap();
        assert!(change.contains("feature/dark"), "{change}");
    }

    #[test]
    fn dates_are_plain() {
        assert!(plain_date("2026-10-23"));
        assert!(
            !plain_date("2026/10/23") && !plain_date("23-10-2026") && !plain_date("2026-10-2x")
        );
    }
}
