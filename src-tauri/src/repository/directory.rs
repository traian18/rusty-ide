//! The repositories of a workspace folder, and which one a path or name belongs to.
//!
//! A workspace folder can hold many repositories (checkouts, worktrees, submodules). Repository
//! documentation is per repository, so every tool call and context request is resolved to exactly
//! one of them here: an explicit name, else the repository whose working tree holds the path, else
//! the active or only one, else an error that lists the candidates. It never guesses.
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use serde::Serialize;

use super::error::RepositoryError;

/// How long a discovery result is reused before the folder is looked at again.
const CACHE: Duration = Duration::from_secs(30);

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct RepoRef {
    /// The canonical working-tree path.
    pub id: String,
    /// The folder's name (not unique across a workspace; paths and ids are).
    pub name: String,
    pub root: PathBuf,
    /// Relative to the workspace folder; empty when the repository is the workspace folder.
    pub relative: String,
    pub kind: String,
    pub branch: Option<String>,
}

impl RepoRef {
    /// A path relative to this repository, from an absolute path or one relative to the workspace.
    fn inside(&self, workspace: &Path, path: &str) -> Option<String> {
        let candidate = Path::new(path);
        let absolute = if candidate.is_absolute() {
            candidate.to_path_buf()
        } else {
            workspace.join(candidate)
        };
        absolute
            .strip_prefix(&self.root)
            .ok()
            .map(|rest| rest.to_string_lossy().replace('\\', "/"))
    }
}

/// How a request was resolved: the repository, and the request's path made relative to it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Resolution {
    pub repository: RepoRef,
    /// The path argument rewritten relative to the repository, when one was given and it lay inside.
    pub path: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Unresolved {
    /// No repository matches the name.
    Unknown(String),
    /// Several could be meant; the caller must say which.
    Ambiguous(Vec<RepoRef>),
}

impl Unresolved {
    pub fn into_error(self) -> RepositoryError {
        match self {
            Self::Unknown(name) => RepositoryError::new(
                "unknown_repository",
                format!("no repository named `{name}` in this workspace"),
            ),
            Self::Ambiguous(candidates) => {
                let list = candidates
                    .iter()
                    .take(20)
                    .map(|r| {
                        if r.relative.is_empty() {
                            r.name.clone()
                        } else {
                            r.relative.clone()
                        }
                    })
                    .collect::<Vec<_>>()
                    .join(", ");
                RepositoryError::new(
                    "ambiguous_repository",
                    format!("which repository? Pass `repository` (a name or path) to choose one of: {list}{}", if candidates.len() > 20 { ", …" } else { "" }),
                )
            }
        }
    }
}

/// The repository an explicit name or path selects: an id, a relative path, a root path or a name.
fn named<'a>(
    repos: &'a [RepoRef],
    workspace: &Path,
    name: &str,
) -> Result<&'a RepoRef, Unresolved> {
    let name = name.trim();
    let exact: Vec<&RepoRef> = repos
        .iter()
        .filter(|r| {
            r.id == name
                || r.relative == name.trim_end_matches('/')
                || r.root == Path::new(name)
                || r.root == workspace.join(name)
        })
        .collect();
    let matches = if exact.is_empty() {
        repos.iter().filter(|r| r.name == name).collect()
    } else {
        exact
    };
    match matches.as_slice() {
        [one] => Ok(one),
        [] => Err(Unresolved::Unknown(name.to_owned())),
        many => Err(Unresolved::Ambiguous(
            many.iter().map(|r| (*r).clone()).collect(),
        )),
    }
}

/// The repository whose working tree holds `path`; the innermost one when repositories nest.
fn containing<'a>(repos: &'a [RepoRef], workspace: &Path, path: &str) -> Option<&'a RepoRef> {
    repos
        .iter()
        .filter(|r| r.inside(workspace, path).is_some())
        .max_by_key(|r| r.root.components().count())
}

/// Resolves a request. `path` is the request's file or folder argument, if any; `active` the
/// repository chosen in the IDE.
pub fn resolve(
    repos: &[RepoRef],
    workspace: &Path,
    explicit: Option<&str>,
    path: Option<&str>,
    active: Option<&str>,
) -> Result<Resolution, Unresolved> {
    let rewrite = |repo: &RepoRef| path.and_then(|p| repo.inside(workspace, p));
    if let Some(name) = explicit.filter(|n| !n.trim().is_empty()) {
        let repo = named(repos, workspace, name)?;
        return Ok(Resolution {
            repository: repo.clone(),
            path: rewrite(repo).or_else(|| path.map(str::to_owned)),
        });
    }
    if let Some(repo) = path.and_then(|p| containing(repos, workspace, p)) {
        return Ok(Resolution {
            repository: repo.clone(),
            path: rewrite(repo),
        });
    }
    if let [only] = repos {
        return Ok(Resolution {
            repository: only.clone(),
            path: path.map(str::to_owned),
        });
    }
    if let Some(repo) = active.and_then(|a| named(repos, workspace, a).ok()) {
        return Ok(Resolution {
            repository: repo.clone(),
            path: path.map(str::to_owned),
        });
    }
    Err(Unresolved::Ambiguous(repos.to_vec()))
}

/// How repositories are found; replaced in tests.
pub type Discover = Box<dyn Fn(&str) -> Result<Vec<RepoRef>, String> + Send + Sync>;

/// What was discovered for one workspace folder, and when.
type Remembered = (Instant, Arc<Vec<RepoRef>>);

/// Discovers a workspace folder's repositories, remembered for a short while.
pub struct RepositoryDirectory {
    discover: Discover,
    cache: Mutex<HashMap<String, Remembered>>,
}

impl RepositoryDirectory {
    /// Discovery through Git, falling back to the folder itself when it holds no repository.
    pub fn git() -> Self {
        Self::with(Box::new(|root| {
            let workspace = std::fs::canonicalize(root).map_err(|e| e.to_string())?;
            let found = crate::git::discover_workspace_repositories(root).unwrap_or_default();
            let mut repos: Vec<RepoRef> = found
                .into_iter()
                .filter(|r| r.initialized)
                .map(|r| {
                    let root = PathBuf::from(&r.worktree_path);
                    RepoRef {
                        relative: root
                            .strip_prefix(&workspace)
                            .map(|p| p.to_string_lossy().replace('\\', "/"))
                            .unwrap_or_default(),
                        name: root.file_name().map_or_else(
                            || r.worktree_path.clone(),
                            |n| n.to_string_lossy().into_owned(),
                        ),
                        id: r.id,
                        root,
                        kind: r.kind,
                        branch: r.head.branch,
                    }
                })
                .collect();
            repos.sort_by(|a, b| a.relative.cmp(&b.relative));
            repos.dedup_by(|a, b| a.root == b.root);
            if repos.is_empty() {
                repos.push(RepoRef {
                    id: workspace.to_string_lossy().into_owned(),
                    name: workspace
                        .file_name()
                        .map_or_else(String::new, |n| n.to_string_lossy().into_owned()),
                    root: workspace,
                    relative: String::new(),
                    kind: "folder".to_owned(),
                    branch: None,
                });
            }
            Ok(repos)
        }))
    }

    pub fn with(discover: Discover) -> Self {
        Self {
            discover,
            cache: Mutex::new(HashMap::new()),
        }
    }

    /// The repositories of `workspace`, from the cache when it is recent.
    pub fn repositories(&self, workspace: &str) -> Result<Arc<Vec<RepoRef>>, RepositoryError> {
        let key = std::fs::canonicalize(workspace)
            .map_err(|e| RepositoryError::invalid(format!("workspace root is not usable: {e}")))?
            .to_string_lossy()
            .into_owned();
        if let Ok(cache) = self.cache.lock() {
            if let Some((at, repos)) = cache.get(&key) {
                if at.elapsed() < CACHE {
                    return Ok(repos.clone());
                }
            }
        }
        let repos = Arc::new(
            (self.discover)(&key).map_err(|e| RepositoryError::new("discovery_failed", e))?,
        );
        if let Ok(mut cache) = self.cache.lock() {
            cache.insert(key, (Instant::now(), repos.clone()));
        }
        Ok(repos)
    }

    /// Forgets what was discovered for `workspace`, so the next call looks again.
    pub fn forget(&self, workspace: &str) {
        if let (Ok(path), Ok(mut cache)) = (std::fs::canonicalize(workspace), self.cache.lock()) {
            cache.remove(&path.to_string_lossy().into_owned());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(relative: &str) -> RepoRef {
        let root = PathBuf::from("/ws").join(relative);
        RepoRef {
            id: root.to_string_lossy().into_owned(),
            name: root.file_name().unwrap().to_string_lossy().into_owned(),
            root,
            relative: relative.to_owned(),
            kind: "workspace".into(),
            branch: Some("main".into()),
        }
    }

    fn many() -> Vec<RepoRef> {
        vec![
            repo("api"),
            repo("web"),
            repo("web/vendor/lib"),
            repo("tools/api"),
            repo("libs/shared"),
            repo("apps/shared"),
        ]
    }

    fn resolve_in(
        repos: &[RepoRef],
        explicit: Option<&str>,
        path: Option<&str>,
        active: Option<&str>,
    ) -> Result<Resolution, Unresolved> {
        resolve(repos, Path::new("/ws"), explicit, path, active)
    }

    #[test]
    fn a_path_selects_the_repository_that_holds_it_and_becomes_relative_to_it() {
        let repos = many();
        let resolved = resolve_in(&repos, None, Some("web/src/a.ts"), None).unwrap();
        assert_eq!(
            (
                resolved.repository.relative.as_str(),
                resolved.path.as_deref()
            ),
            ("web", Some("src/a.ts"))
        );
        let absolute = resolve_in(&repos, None, Some("/ws/api/src/lib.rs"), None).unwrap();
        assert_eq!(
            (
                absolute.repository.relative.as_str(),
                absolute.path.as_deref()
            ),
            ("api", Some("src/lib.rs"))
        );
    }

    #[test]
    fn the_innermost_repository_wins_when_repositories_nest() {
        let resolved = resolve_in(&many(), None, Some("web/vendor/lib/x.ts"), None).unwrap();
        assert_eq!(
            (
                resolved.repository.relative.as_str(),
                resolved.path.as_deref()
            ),
            ("web/vendor/lib", Some("x.ts"))
        );
    }

    #[test]
    fn an_explicit_repository_wins_over_the_path_and_may_be_a_name_a_path_or_an_id() {
        let repos = many();
        for name in ["web", "/ws/web"] {
            assert_eq!(
                resolve_in(&repos, Some(name), Some("api/src/a.rs"), None)
                    .unwrap()
                    .repository
                    .relative,
                "web"
            );
        }
        assert_eq!(
            resolve_in(&repos, Some("tools/api"), None, None)
                .unwrap()
                .repository
                .relative,
            "tools/api"
        );
        let id = repos[1].id.clone();
        assert_eq!(
            resolve_in(&repos, Some(&id), None, None)
                .unwrap()
                .repository
                .relative,
            "web"
        );
        // A path that is already relative to the chosen repository stays as it is.
        assert_eq!(
            resolve_in(&repos, Some("web"), Some("src/a.ts"), None)
                .unwrap()
                .path
                .as_deref(),
            Some("src/a.ts")
        );
    }

    #[test]
    fn a_name_two_repositories_share_is_ambiguous_and_an_unknown_one_is_an_error() {
        let repos = many();
        // A relative path is exact, so `api` is the top-level one; only a bare shared name is ambiguous.
        assert_eq!(
            resolve_in(&repos, Some("api"), None, None)
                .unwrap()
                .repository
                .relative,
            "api"
        );
        let Err(Unresolved::Ambiguous(candidates)) = resolve_in(&repos, Some("shared"), None, None)
        else {
            panic!("shared is ambiguous")
        };
        assert_eq!(candidates.len(), 2);
        let error = Unresolved::Ambiguous(candidates).into_error();
        assert_eq!(error.code, "ambiguous_repository");
        assert!(
            error.message.contains("libs/shared, apps/shared")
                || error.message.contains("apps/shared, libs/shared"),
            "{}",
            error.message
        );
        assert_eq!(
            resolve_in(&repos, Some("nope"), None, None)
                .unwrap_err()
                .into_error()
                .code,
            "unknown_repository"
        );
    }

    #[test]
    fn without_a_name_or_a_path_the_active_or_only_repository_is_used_or_the_call_fails() {
        let repos = many();
        assert_eq!(
            resolve_in(&repos, None, Some("src/a.ts"), Some("/ws/web"))
                .unwrap()
                .repository
                .relative,
            "web"
        );
        assert_eq!(
            resolve_in(&repos, None, None, None)
                .unwrap_err()
                .into_error()
                .code,
            "ambiguous_repository"
        );
        let single = vec![repo("only")];
        let resolved = resolve_in(&single, None, Some("src/a.rs"), None).unwrap();
        assert_eq!(
            (
                resolved.repository.relative.as_str(),
                resolved.path.as_deref()
            ),
            ("only", Some("src/a.rs"))
        );
    }

    #[test]
    fn discovery_is_remembered_until_forgotten() {
        let counter = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let seen = counter.clone();
        let directory = RepositoryDirectory::with(Box::new(move |_| {
            seen.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(vec![repo("api")])
        }));
        let workspace = tempfile::tempdir().unwrap();
        let path = workspace.path().to_str().unwrap();
        directory.repositories(path).unwrap();
        directory.repositories(path).unwrap();
        assert_eq!(counter.load(std::sync::atomic::Ordering::SeqCst), 1);
        directory.forget(path);
        directory.repositories(path).unwrap();
        assert_eq!(counter.load(std::sync::atomic::Ordering::SeqCst), 2);
    }
}
