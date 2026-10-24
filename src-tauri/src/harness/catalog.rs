//! The workflow catalog: the one place that knows which workflows and
//! behavior profiles exist for a workspace.
//!
//! It aggregates three sources into one list, read afresh on every call so
//! nobody holds a stale copy:
//!
//! - `core`: rusty-core's own default profile;
//! - `builtin`: the app's generated catalog (`starter/catalog.json`), whose
//!   ids already carry the `rusty-ide.builtin.` namespace;
//! - `workspace`: what the user saved in `.rusty/workflows` and
//!   `.rusty/profiles`.
//!
//! Choosing a workflow, opening one in the editor, starting a run (and the
//! flows it may run) and validating an authored one all read from here.

use std::fs;
use std::path::Path;

use serde::Serialize;
use serde_json::Value;

const BUILTIN_CATALOG: &str =
    include_str!("../../../src/components/tabs/behaviors/starter/catalog.json");

/// Where a built-in workflow is listed: `builtin:<id without namespace>`.
pub const BUILTIN_PATH_PREFIX: &str = "builtin:";
pub const BUILTIN_ID_PREFIX: &str = "rusty-ide.builtin.";
const DEFAULT_WORKFLOW: &str = "plan-build-verify";
const WORKFLOWS_DIR: &str = ".rusty/workflows";
const PROFILES_DIR: &str = ".rusty/profiles";
/// Names the workspace default profile; not a profile itself.
const PROFILES_CONFIG: &str = "config.json";

/// Copies of Plan, build, verify that older versions of the app wrote into
/// workspaces. One left unmodified is the built-in under another name, so it
/// is not listed and its path opens the built-in.
const LEGACY_STARTERS: [&str; 9] = [
    include_str!("../../../src/components/tabs/behaviors/starter/legacy/v1/plan-build-verify.workflow.json"),
    include_str!("../../../src/components/tabs/behaviors/starter/legacy/v2/plan-build-verify.workflow.json"),
    include_str!("../../../src/components/tabs/behaviors/starter/legacy/v3/plan-build-verify.workflow.json"),
    include_str!("../../../src/components/tabs/behaviors/starter/legacy/v4/plan-build-verify.workflow.json"),
    include_str!("../../../src/components/tabs/behaviors/starter/legacy/v5/plan-build-verify.workflow.json"),
    include_str!("../../../src/components/tabs/behaviors/starter/legacy/v6/plan-build-verify.workflow.json"),
    include_str!("../../../src/components/tabs/behaviors/starter/legacy/v7/plan-build-verify.workflow.json"),
    include_str!("../../../src/components/tabs/behaviors/starter/legacy/v8/plan-build-verify.workflow.json"),
    include_str!("../../../src/components/tabs/behaviors/starter/legacy/before-task-queue/plan-build-verify.workflow.json"),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    Core,
    Builtin,
    Workspace,
}

/// One workflow or profile, with where it lives: a file path for workspace
/// documents, `builtin:<id>` for built-in workflows, the id for built-in
/// profiles.
#[derive(Debug, Clone, Serialize)]
pub struct Entry {
    pub path: String,
    pub source: Source,
    pub document: Value,
}

/// A workspace file that could not be read as a JSON object.
#[derive(Debug, Clone, Serialize)]
pub struct Failure {
    pub path: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Catalog {
    /// Built-in workflows in picker order, then the workspace's by path.
    pub workflows: Vec<Entry>,
    /// The core default, the built-in profiles, then the workspace's by path.
    pub profiles: Vec<Entry>,
    pub failures: Vec<Failure>,
    /// What a new workflow starts from.
    pub default_workflow: Value,
}

fn builtin_documents(kind: &str) -> Vec<Value> {
    serde_json::from_str::<Value>(BUILTIN_CATALOG).expect("generated catalog")[kind]
        .as_array()
        .expect("catalog lists")
        .clone()
}

fn builtin_path(id: &str) -> String {
    format!(
        "{BUILTIN_PATH_PREFIX}{}",
        id.strip_prefix(BUILTIN_ID_PREFIX).unwrap_or(id)
    )
}

fn is_legacy_starter(document: &Value) -> bool {
    LEGACY_STARTERS
        .iter()
        .any(|legacy| serde_json::from_str::<Value>(legacy).ok().as_ref() == Some(document))
}

/// The JSON objects in `dir`, by path, except the `skip` file names.
fn read_dir(dir: &Path, skip: &[&str]) -> (Vec<(String, Value)>, Vec<Failure>) {
    let mut paths: Vec<_> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && path.extension().is_some_and(|ext| ext == "json"))
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| !skip.contains(&name))
        })
        .collect();
    paths.sort();
    let mut documents = Vec::new();
    let mut failures = Vec::new();
    for path in paths {
        let shown = path.to_string_lossy().into_owned();
        let parsed = fs::read_to_string(&path)
            .map_err(|error| error.to_string())
            .and_then(|text| serde_json::from_str::<Value>(&text).map_err(|e| e.to_string()))
            .and_then(|value| {
                value
                    .is_object()
                    .then_some(value)
                    .ok_or_else(|| "not a JSON object".to_owned())
            });
        match parsed {
            Ok(document) => documents.push((shown, document)),
            Err(error) => failures.push(Failure { path: shown, error }),
        }
    }
    (documents, failures)
}

impl Catalog {
    /// Everything available in the workspace at `root`; only the built-ins
    /// without one.
    pub fn load(root: Option<&Path>) -> Catalog {
        let mut catalog = Catalog {
            workflows: builtin_documents("workflows")
                .into_iter()
                .map(|document| Entry {
                    path: builtin_path(document["id"].as_str().unwrap_or_default()),
                    source: Source::Builtin,
                    document,
                })
                .collect(),
            profiles: std::iter::once((
                Source::Core,
                harness_engine::validation::templates().builtin_profiles,
            ))
            .chain(std::iter::once((
                Source::Builtin,
                builtin_documents("profiles"),
            )))
            .flat_map(|(source, documents)| {
                documents.into_iter().map(move |document| Entry {
                    path: document["id"].as_str().unwrap_or_default().to_owned(),
                    source,
                    document,
                })
            })
            .collect(),
            failures: Vec::new(),
            default_workflow: harness_engine::validation::templates().default_workflow,
        };
        let Some(root) = root else {
            return catalog;
        };
        let (workflows, failed) = read_dir(&root.join(WORKFLOWS_DIR), &[]);
        catalog.failures.extend(failed);
        catalog.workflows.extend(
            workflows
                .into_iter()
                .filter(|(_, document)| !is_legacy_starter(document))
                .map(|(path, document)| Entry {
                    path,
                    source: Source::Workspace,
                    document,
                }),
        );
        let (profiles, failed) = read_dir(&root.join(PROFILES_DIR), &[PROFILES_CONFIG]);
        catalog.failures.extend(failed);
        catalog
            .profiles
            .extend(profiles.into_iter().map(|(path, document)| Entry {
                path,
                source: Source::Workspace,
                document,
            }));
        catalog
    }

    /// The workflow listed at `path`. A path an older version of the app
    /// wrote Plan, build, verify to opens the built-in one.
    pub fn workflow(&self, path: &str) -> Option<&Value> {
        let listed = |path: &str| {
            self.workflows
                .iter()
                .find(|entry| entry.path == path)
                .map(|entry| &entry.document)
        };
        listed(path).or_else(|| {
            let normalized = path.replace('\\', "/");
            let legacy = [".json", ".workflow.json"].iter().any(|ext| {
                normalized.ends_with(&format!("/{WORKFLOWS_DIR}/{DEFAULT_WORKFLOW}{ext}"))
            });
            legacy
                .then(|| listed(&format!("{BUILTIN_PATH_PREFIX}{DEFAULT_WORKFLOW}")))
                .flatten()
        })
    }

    /// Every profile document, for validation and for registering with a session.
    pub fn profile_documents(&self) -> Vec<Value> {
        self.profiles
            .iter()
            .map(|entry| entry.document.clone())
            .collect()
    }

    /// The documents of the profiles from `source`.
    pub fn profiles_from(&self, source: Source) -> impl Iterator<Item = &Value> {
        self.profiles
            .iter()
            .filter(move |entry| entry.source == source)
            .map(|entry| &entry.document)
    }

    /// Every workflow document, built-in and saved.
    pub fn workflow_documents(&self) -> impl Iterator<Item = &Value> {
        self.workflows.iter().map(|entry| &entry.document)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn write(root: &Path, relative: &str, content: &str) {
        let path = root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    #[test]
    fn without_a_workspace_it_lists_the_built_ins_under_their_namespace() {
        let catalog = Catalog::load(None);
        assert_eq!(catalog.workflows.len(), 20);
        assert_eq!(catalog.workflows[0].path, "builtin:plan-build-verify");
        assert_eq!(
            catalog.workflows[0].document["id"],
            "rusty-ide.builtin.plan-build-verify"
        );
        assert_eq!(catalog.profiles[0].source, Source::Core);
        assert_eq!(catalog.profiles_from(Source::Builtin).count(), 12);
        assert!(catalog
            .profiles_from(Source::Builtin)
            .all(|profile| profile["id"]
                .as_str()
                .unwrap()
                .starts_with(BUILTIN_ID_PREFIX)));
        assert!(catalog.failures.is_empty());
    }

    #[test]
    fn every_built_in_profile_that_may_read_files_may_use_repo_context() {
        // repo_context is admitted by the read_file grant (rusty-core `tool_alias`), so a profile
        // is covered when it lists read_file or names repo_context itself.
        for profile in Catalog::load(None).profiles_from(Source::Builtin) {
            let tools = &profile["tools"]["tools"];
            let names = tools.as_array().expect("built-in profiles use allow-lists");
            assert!(
                names
                    .iter()
                    .any(|name| name == "read_file" || name == "repo_context"),
                "{} cannot read files, so repo_context would be hidden",
                profile["id"]
            );
        }
    }

    #[test]
    fn each_built_in_workflow_is_listed_at_builtin_and_its_short_id() {
        for entry in Catalog::load(None).workflows {
            let id = entry.document["id"].as_str().unwrap();
            assert_eq!(
                entry.path,
                format!("builtin:{}", id.strip_prefix(BUILTIN_ID_PREFIX).unwrap())
            );
        }
    }

    #[test]
    fn workspace_documents_follow_the_built_ins_and_bad_files_are_reported() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), ".rusty/workflows/b.json", r#"{"id":"b"}"#);
        write(dir.path(), ".rusty/workflows/a.json", r#"{"id":"a"}"#);
        write(dir.path(), ".rusty/workflows/broken.json", "{");
        write(dir.path(), ".rusty/workflows/notes.txt", "ignored");
        write(dir.path(), ".rusty/profiles/plan.json", r#"{"id":"plan"}"#);
        write(
            dir.path(),
            ".rusty/profiles/config.json",
            r#"{"default":{"id":"plan"}}"#,
        );
        let catalog = Catalog::load(Some(dir.path()));
        let saved: Vec<_> = catalog
            .workflows
            .iter()
            .filter(|entry| entry.source == Source::Workspace)
            .map(|entry| entry.document["id"].clone())
            .collect();
        assert_eq!(saved, vec![json!("a"), json!("b")]);
        let profiles: Vec<_> = catalog.profiles_from(Source::Workspace).collect();
        assert_eq!(profiles, vec![&json!({"id": "plan"})]);
        assert_eq!(catalog.failures.len(), 1);
        assert!(catalog.failures[0].path.ends_with("broken.json"));
    }

    #[test]
    fn it_reads_the_disk_on_every_call() {
        let dir = tempfile::tempdir().unwrap();
        let count = || Catalog::load(Some(dir.path())).workflows.len();
        let before = count();
        write(dir.path(), ".rusty/workflows/new.json", r#"{"id":"new"}"#);
        assert_eq!(count(), before + 1);
    }

    #[test]
    fn an_unmodified_old_starter_copy_is_the_built_in() {
        let dir = tempfile::tempdir().unwrap();
        write(
            dir.path(),
            ".rusty/workflows/plan-build-verify.json",
            LEGACY_STARTERS[0],
        );
        let catalog = Catalog::load(Some(dir.path()));
        assert!(catalog
            .workflows
            .iter()
            .all(|entry| entry.source == Source::Builtin));
        let opened = catalog
            .workflow(&format!(
                "{}/.rusty/workflows/plan-build-verify.json",
                dir.path().display()
            ))
            .unwrap();
        assert_eq!(opened["id"], "rusty-ide.builtin.plan-build-verify");
        assert!(catalog.workflow("/elsewhere/other.json").is_none());
    }
}
