//! Changes linked across the repositories of a workspace: creating one part per repository on a
//! shared branch, telling a run on one part where it is and what the other parts are, and
//! switching every part to the change's branch together. The format lives in
//! `harness_specs::linked`.
use std::{
    path::{Path, PathBuf},
    process::Command,
};

use harness_specs::{
    layout::Layout,
    linked::{self, Found},
    parse,
    record::Step,
    scaffold::{self, ChangeRequest, LinkedRequest},
    FsStore, SpecStore,
};
use serde::Serialize;

use super::{
    branch::{self, BranchOutcome},
    commands::{blocking, folder, plain_date, spec_error},
};
use crate::repository::error::RepositoryError;

/// Where a repository sits: its name in the workspace (`rusty-core`, `apps/web`), the folder its
/// linked parts are found from, and whether the run works in a workspace that holds it.
pub(super) struct Place {
    name: String,
    base: PathBuf,
    in_workspace: bool,
}

impl Place {
    /// Inside `workspace`, the repository is named by its path there. Opened on its own, it is
    /// named by its folder and its linked parts are looked for next to it.
    pub(super) fn of(workspace: Option<&str>, root: &Path) -> Self {
        let root = canonical(root);
        if let Some(workspace) = workspace.map(|w| canonical(Path::new(w))) {
            if let Some(name) = relative(&workspace, &root) {
                return Self {
                    name,
                    base: workspace,
                    in_workspace: true,
                };
            }
        }
        Self {
            name: root
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            base: root.parent().map(Path::to_path_buf).unwrap_or_default(),
            in_workspace: false,
        }
    }

    /// The first line of a run's context when the run works in the workspace, not the repository.
    pub(super) fn preamble(&self) -> String {
        if !self.in_workspace {
            return String::new();
        }
        format!(
            "The repository is the folder {0}/ of the workspace this run works in. Paths in this context are relative to that repository: prefix them with {0}/ to open them, and give {0} as the path when you run its checks.\n\n",
            self.name
        )
    }

    /// For a linked change, what a run on this part needs about the others; empty otherwise.
    pub(super) fn linked_context(&self, store: &dyn SpecStore, change: &str, step: Step) -> String {
        let path = format!("{}/change.md", Layout::of(store).change(change));
        let front = store
            .read(&path)
            .map(|text| parse::front::change(&text))
            .unwrap_or_default();
        let parts: Vec<_> = front
            .links
            .iter()
            .filter_map(|l| linked::parse_link(l))
            .collect();
        let stores: Vec<Option<FsStore>> = parts
            .iter()
            .map(|part| {
                let root = self.base.join(&part.repository);
                root.is_dir().then(|| FsStore::new(root))
            })
            .collect();
        let found: Vec<Found> = parts
            .into_iter()
            .zip(&stores)
            .map(|(part, store)| Found {
                part,
                store: store.as_ref().map(|s| s as &dyn SpecStore),
            })
            .collect();
        linked::compose(&self.name, &front, step, &found)
    }
}

fn canonical(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// `root` relative to `workspace` with `/` separators; `None` when it is not strictly inside.
fn relative(workspace: &Path, root: &Path) -> Option<String> {
    let parts: Vec<String> = root
        .strip_prefix(workspace)
        .ok()?
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    (!parts.is_empty()).then(|| parts.join("/"))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedPart {
    /// The repository's path in the workspace.
    pub repository: String,
    pub root: String,
    pub dir: String,
    pub main: bool,
    pub files: Vec<String>,
    pub branch: Option<BranchOutcome>,
}

/// Creates one change per repository in `roots`, linked to each other. `main` holds the whole
/// change's spec; the others get a spec that points to it. Every part gets the next number of its
/// own repository, and with `branch` all of them switch to one branch: `branch_name`, or one named
/// after the main part.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn specs_linked_change_create(
    workspace: String,
    roots: Vec<String>,
    main: String,
    title: String,
    description: String,
    date: String,
    branch: bool,
    branch_name: Option<String>,
) -> Result<Vec<CreatedPart>, RepositoryError> {
    blocking(move || {
        if title.trim().is_empty() {
            return Err(RepositoryError::invalid("a change needs a title"));
        }
        if !plain_date(&date) {
            return Err(RepositoryError::invalid("the date must be YYYY-MM-DD"));
        }
        let workspace = canonical(&folder(&workspace)?);
        let main = canonical(&folder(&main)?);
        let mut parts = Vec::new();
        for root in &roots {
            let root = canonical(&folder(root)?);
            let name = relative(&workspace, &root).ok_or_else(|| {
                RepositoryError::invalid(format!(
                    "{} is not a repository of the workspace",
                    root.display()
                ))
            })?;
            if parts.iter().any(|(_, other, _)| *other == name) {
                continue;
            }
            let plan = scaffold::plan_change(&FsStore::new(&root), &title);
            parts.push((root, name, plan));
        }
        // The main part first: its folder names the branch and the others point to its spec.
        let Some(at) = parts.iter().position(|(root, _, _)| *root == main) else {
            return Err(RepositoryError::invalid(
                "the main repository must be one of the linked repositories",
            ));
        };
        parts.swap(0, at);
        if parts.len() < 2 {
            return Err(RepositoryError::invalid(
                "a linked change needs at least two repositories",
            ));
        }
        let branch_name = branch::chosen_name(branch_name.as_deref(), &parts[0].2.branch);
        let main_name = parts[0].1.clone();
        let main_overview = format!(
            "{main_name}/{}/overview.md",
            Layout::of(&FsStore::new(&parts[0].0)).change(&parts[0].2.dir)
        );
        let links: Vec<String> = parts
            .iter()
            .map(|(_, name, plan)| format!("{name}/{}", plan.dir))
            .collect();
        let mut created = Vec::new();
        for (index, (root, name, plan)) in parts.iter().enumerate() {
            let outcome = branch.then(|| branch::create_and_switch(root, &branch_name));
            let others: Vec<String> = links
                .iter()
                .enumerate()
                .filter(|(i, _)| *i != index)
                .map(|(_, link)| link.clone())
                .collect();
            let description = if index == 0 {
                description.clone()
            } else {
                format!(
                    "This is the {name} part of a change linked across repositories. It is self-contained: its spec says everything {name} delivers, checkable with {name}'s own tests. The overview of the whole change, when written, is {main_overview}.\n\n{}",
                    description.trim()
                )
            };
            let request = ChangeRequest {
                title: &title,
                description: &description,
                date: &date,
                branch: match &outcome {
                    Some(BranchOutcome::Created { name }) => Some(name.as_str()),
                    _ => None,
                },
                linked: Some(LinkedRequest {
                    main: &main_name,
                    links: &others,
                }),
            };
            let files = scaffold::create_change(&FsStore::new(root), plan, &request)
                .map_err(spec_error)?;
            created.push(CreatedPart {
                repository: name.clone(),
                root: root.to_string_lossy().into_owned(),
                dir: plan.dir.clone(),
                main: index == 0,
                files,
                branch: outcome,
            });
        }
        Ok(created)
    })
    .await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum SwitchOutcome {
    /// Now on the branch; `stashed` and `restored` say what happened to uncommitted work.
    Switched {
        stashed: bool,
        restored: bool,
    },
    Already,
    /// The part has no branch, or its repository is not in the workspace.
    Skipped {
        reason: String,
    },
    Failed {
        message: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchedPart {
    pub repository: String,
    pub branch: Option<String>,
    pub outcome: SwitchOutcome,
}

/// Switches this change's repository and every linked part to the part's branch, the way the
/// branch menu does: uncommitted work is stashed for the branch it was on and restored when
/// that branch is opened again. Called from the part the person has open, so its change exists.
#[tauri::command]
pub async fn specs_linked_switch(
    workspace: Option<String>,
    root: String,
    change: String,
) -> Result<Vec<SwitchedPart>, RepositoryError> {
    let targets = blocking(move || {
        let root = folder(&root)?;
        let place = Place::of(workspace.as_deref(), &root);
        let store = FsStore::new(&root);
        let front = change_front(&store, &change)
            .ok_or_else(|| RepositoryError::invalid(format!("{change} is not a change")))?;
        let mut targets = vec![(place.name.clone(), Some(root.clone()), front.branch.clone())];
        for part in front.links.iter().filter_map(|l| linked::parse_link(l)) {
            let part_root = place.base.join(&part.repository);
            // A part on another branch may not show its change.md; the parts share one branch name.
            let branch = part_root
                .is_dir()
                .then(|| change_front(&FsStore::new(&part_root), &part.dir))
                .flatten()
                .and_then(|f| f.branch)
                .or_else(|| front.branch.clone());
            targets.push((
                part.repository,
                part_root.is_dir().then_some(part_root),
                branch,
            ));
        }
        Ok(targets)
    })
    .await?;
    let mut switched = Vec::new();
    for (repository, root, branch) in targets {
        let outcome = match (&root, &branch) {
            (None, _) => SwitchOutcome::Skipped {
                reason: "the repository is not in this workspace".into(),
            },
            (_, None) => SwitchOutcome::Skipped {
                reason: "this part has no branch".into(),
            },
            (Some(root), Some(branch)) if current_branch(root).as_deref() == Some(branch) => {
                SwitchOutcome::Already
            }
            (Some(root), Some(branch)) => match crate::git::git_smart_checkout_branch(
                root.to_string_lossy().into_owned(),
                branch.clone(),
            )
            .await
            {
                Ok(result) => SwitchOutcome::Switched {
                    stashed: result.stashed,
                    restored: result.restored,
                },
                Err(error) => SwitchOutcome::Failed {
                    message: error.message,
                },
            },
        };
        switched.push(SwitchedPart {
            repository,
            branch,
            outcome,
        });
    }
    Ok(switched)
}

fn change_front(store: &dyn SpecStore, dir: &str) -> Option<harness_specs::model::ChangeFront> {
    let path = format!("{}/change.md", Layout::of(store).change(dir));
    store.read(&path).map(|text| parse::front::change(&text))
}

fn current_branch(root: &Path) -> Option<String> {
    let output = Command::new("git")
        .args(["branch", "--show-current"])
        .current_dir(root)
        .output()
        .ok()?;
    let name = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    (output.status.success() && !name.is_empty()).then_some(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git(root: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args(["-c", "user.name=t", "-c", "user.email=t@t"])
            .args(args)
            .current_dir(root)
            .status()
            .unwrap();
        assert!(status.success(), "git {args:?}");
    }

    fn repository(workspace: &Path, name: &str) -> PathBuf {
        let root = workspace.join(name);
        std::fs::create_dir_all(&root).unwrap();
        git(&root, &["init", "-q", "-b", "main"]);
        std::fs::write(root.join("README.md"), "x").unwrap();
        git(&root, &["add", "."]);
        git(&root, &["commit", "-q", "-m", "init"]);
        root
    }

    fn text(path: PathBuf) -> String {
        std::fs::read_to_string(path).unwrap()
    }

    #[test]
    fn a_repository_is_named_by_its_path_in_the_workspace_or_by_its_folder() {
        let workspace = tempfile::tempdir().unwrap();
        let nested = workspace.path().join("apps/web");
        std::fs::create_dir_all(&nested).unwrap();
        let workspace_root = workspace.path().to_str().unwrap();
        let place = Place::of(Some(workspace_root), &nested);
        assert_eq!(place.name, "apps/web");
        assert!(place
            .preamble()
            .contains("the folder apps/web/ of the workspace"));
        let alone = Place::of(Some(nested.to_str().unwrap()), &nested);
        assert_eq!(alone.name, "web");
        assert_eq!(alone.preamble(), "");
    }

    #[tokio::test]
    async fn a_linked_change_gets_a_part_per_repository_on_one_branch_and_switches_together() {
        let workspace = tempfile::tempdir().unwrap();
        let ide = repository(workspace.path(), "ide");
        let core = repository(workspace.path(), "core");
        // The core already has a change, so its part gets the next number there.
        std::fs::create_dir_all(core.join("specs/changes/0001-old")).unwrap();
        std::fs::write(core.join("specs/changes/0001-old/spec.md"), "# Old\n").unwrap();
        let path = |p: &Path| p.to_string_lossy().into_owned();
        let parts = specs_linked_change_create(
            path(workspace.path()),
            vec![path(&core), path(&ide)],
            path(&ide),
            "Dark mode".into(),
            "Night use.".into(),
            "2026-10-24".into(),
            true,
            None,
        )
        .await
        .unwrap();
        let summary: Vec<(&str, &str, bool)> = parts
            .iter()
            .map(|p| (p.repository.as_str(), p.dir.as_str(), p.main))
            .collect();
        assert_eq!(
            summary,
            [
                ("ide", "0001-dark-mode", true),
                ("core", "0002-dark-mode", false)
            ]
        );
        assert_eq!(
            current_branch(&core).as_deref(),
            Some("spec/0001-dark-mode")
        );
        assert_eq!(current_branch(&ide).as_deref(), Some("spec/0001-dark-mode"));
        let main_change = text(ide.join("specs/changes/0001-dark-mode/change.md"));
        assert!(
            main_change.contains("main: ide")
                && main_change.contains("links: [core/0002-dark-mode]")
        );
        let part_spec = text(core.join("specs/changes/0002-dark-mode/spec.md"));
        assert!(
            part_spec.contains("This is the core part")
                && part_spec.contains("self-contained")
                && part_spec.contains("ide/specs/changes/0001-dark-mode/overview.md")
        );

        let place = Place::of(Some(&path(workspace.path())), &core);
        let context = place.linked_context(&FsStore::new(&core), "0002-dark-mode", Step::Specify);
        assert!(
            context.contains("write the complete spec of what core delivers, and only that")
                && context.contains("ide (0001-dark-mode), the main spec")
        );

        // The person is on the change in ide; core went back to main meanwhile.
        for root in [&ide, &core] {
            git(root, &["add", "."]);
            git(root, &["commit", "-q", "-m", "spec"]);
        }
        git(&core, &["switch", "-q", "main"]);
        let switched = specs_linked_switch(
            Some(path(workspace.path())),
            path(&ide),
            "0001-dark-mode".into(),
        )
        .await
        .unwrap();
        assert!(
            matches!(switched[0].outcome, SwitchOutcome::Already),
            "{switched:?}"
        );
        assert!(
            matches!(switched[1].outcome, SwitchOutcome::Switched { .. }),
            "{switched:?}"
        );
        assert_eq!(
            current_branch(&core).as_deref(),
            Some("spec/0001-dark-mode")
        );
        let again = specs_linked_switch(
            Some(path(workspace.path())),
            path(&ide),
            "0001-dark-mode".into(),
        )
        .await
        .unwrap();
        assert!(again
            .iter()
            .all(|p| matches!(p.outcome, SwitchOutcome::Already)));
    }

    #[tokio::test]
    async fn the_main_repository_must_be_one_of_the_parts() {
        let workspace = tempfile::tempdir().unwrap();
        let ide = repository(workspace.path(), "ide");
        let core = repository(workspace.path(), "core");
        let path = |p: &Path| p.to_string_lossy().into_owned();
        let error = specs_linked_change_create(
            path(workspace.path()),
            vec![path(&core)],
            path(&ide),
            "X".into(),
            String::new(),
            "2026-10-24".into(),
            false,
            None,
        )
        .await
        .unwrap_err();
        assert!(error.message.contains("main repository"));
    }
}
