//! Repository documentation as session context: what the recipe asks for, the repository services
//! it reads, and the observer that records what each request was given.
use std::{
    collections::{HashMap, HashSet},
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use async_trait::async_trait;
use harness_context::ContextProvider;
use harness_context_repository::{
    ContextObserver, InjectionReport, RepositoryContextConfig, RepositoryContextProvider,
};
use harness_protocol::{
    backend::ExecutionRequest,
    messages::{ContentBlock, MessageRole},
};
use harness_repository_wiki::{FocusSet, StaticFocus, TaskKind};
use harness_runtime::traits::Workspace;
use serde::Deserialize;
use serde_json::json;

use crate::repository::{
    directory::{resolve, RepoRef},
    Entry, RepositoryState,
};

/// What the IDE says about the work in progress, per session. Absent means no repository context.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RepositoryContextSpec {
    /// Off when the person has switched repository context off.
    #[serde(default = "enabled")]
    pub enabled: bool,
    /// The file open in the editor, relative to the workspace root.
    #[serde(default)]
    pub active_file: Option<String>,
    /// Files read or edited earlier in this chat.
    #[serde(default)]
    pub touched: Vec<String>,
    /// The repository chosen in the IDE (its id or path): the one a request is about when it names
    /// nothing else.
    #[serde(default)]
    pub active_repository: Option<String>,
    /// The running profile's id (`refactor`, `rusty-ide.builtin.debug`), which decides how far the
    /// context reaches from the files it is anchored on.
    #[serde(default)]
    pub task: Option<String>,
    /// Characters of retrieved pages, sized by the IDE from the model's window.
    #[serde(default)]
    pub max_chars: Option<usize>,
}

fn enabled() -> bool {
    true
}

/// The context providers of a session, in the order they assemble: the system prompt, then the
/// documentation of the repositories the request is about, appended to it, when the recipe asked
/// for it.
pub fn providers(
    system_prompt: Option<String>,
    spec: Option<&RepositoryContextSpec>,
    repositories: Option<&RepositoryState>,
    workspace: &str,
) -> Vec<Arc<dyn harness_context::ContextProvider>> {
    let mut providers: Vec<Arc<dyn harness_context::ContextProvider>> = Vec::new();
    if let Some(prompt) = system_prompt {
        providers.push(Arc::new(harness_context::StaticSystemPromptProvider::new(
            prompt,
        )));
    }
    if let (Some(spec), Some(state)) = (spec, repositories) {
        if spec.enabled {
            providers.push(Arc::new(WorkspaceContextProvider::new(
                state.clone(),
                workspace.to_owned(),
                spec.clone(),
            )));
        }
    }
    providers
}

/// Documentation context for a workspace that may hold many repositories. Each request is matched
/// to the repositories it is about (paths it names, the editor's file, the chosen repository);
/// each gets its own page excerpts from its own index, and a short map of the workspace lets the
/// model name the repository it wants. An unindexed repository the request is about is indexed in
/// the background for the next request; nothing is indexed because it exists.
pub struct WorkspaceContextProvider {
    state: RepositoryState,
    workspace: String,
    spec: RepositoryContextSpec,
    providers: Mutex<HashMap<(String, bool), Arc<RepositoryContextProvider>>>,
    indexing: Arc<Mutex<HashSet<String>>>,
}

/// Repositories documented for one request.
const MAX_REPOSITORIES: usize = 3;
/// Repositories listed in the workspace map, and its size.
const MAP_REPOSITORIES: usize = 40;
const MAP_CHARS: usize = 1_200;
/// Share of the character budget the primary repository gets when others are involved.
const PRIMARY_SHARE: usize = 60;

impl WorkspaceContextProvider {
    pub fn new(state: RepositoryState, workspace: String, spec: RepositoryContextSpec) -> Self {
        Self {
            state,
            workspace,
            spec,
            providers: Mutex::new(HashMap::new()),
            indexing: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    /// The repositories the request is about, the primary one first.
    fn involved(&self, repos: &[RepoRef], workspace: &Path, message: &str) -> Vec<RepoRef> {
        let mut out: Vec<RepoRef> = Vec::new();
        let mut add = |repo: &RepoRef| {
            if !out.iter().any(|r| r.id == repo.id) {
                out.push(repo.clone());
            }
        };
        let owner = |path: &str| {
            resolve(repos, workspace, None, Some(path), None)
                .ok()
                .filter(|r| r.path.is_some())
                .map(|r| r.repository)
        };
        if let Some(repo) = self.spec.active_file.as_deref().and_then(owner) {
            add(&repo);
        }
        for token in message.split(|c: char| c.is_whitespace() || "\"'`()[]<>,;{}".contains(c)) {
            let token = token.trim_end_matches(['.', '?', '!', ':']);
            if token.is_empty() {
                continue;
            }
            if let Some(repo) = owner(token) {
                add(&repo);
            } else if repos.len() > 1 {
                // A repository named on its own ("in api", "the web repo").
                if let Some(repo) = repos
                    .iter()
                    .find(|r| r.name == token || (!r.relative.is_empty() && r.relative == token))
                {
                    add(repo);
                }
            }
        }
        for file in &self.spec.touched {
            if let Some(repo) = owner(file) {
                add(&repo);
            }
        }
        if let Some(repo) = self
            .spec
            .active_repository
            .as_deref()
            .and_then(|a| resolve(repos, workspace, Some(a), None, None).ok())
            .map(|r| r.repository)
        {
            add(&repo);
        }
        if repos.len() == 1 {
            add(&repos[0]);
        }
        out.truncate(MAX_REPOSITORIES);
        out
    }

    /// The provider for one repository, with the work in progress made relative to it.
    fn provider_for(
        &self,
        repo: &RepoRef,
        repos: &[RepoRef],
        workspace: &Path,
        entry: &Entry,
        primary: bool,
        share: usize,
    ) -> Arc<RepositoryContextProvider> {
        let key = (repo.id.clone(), primary);
        if let Some(existing) = self
            .providers
            .lock()
            .ok()
            .and_then(|m| m.get(&key).cloned())
        {
            return existing;
        }
        let relative = |path: &str| {
            resolve(repos, workspace, Some(&repo.id), Some(path), None)
                .ok()
                .and_then(|r| r.path)
        };
        let focus = FocusSet {
            active_file: self.spec.active_file.as_deref().and_then(relative),
            touched: self
                .spec
                .touched
                .iter()
                .filter_map(|f| relative(f))
                .collect(),
            ..FocusSet::default()
        };
        let mut config = RepositoryContextConfig {
            point_to_tool: true,
            brief: primary,
            ..RepositoryContextConfig::default()
        };
        if let Some(max) = self.spec.max_chars {
            config.max_chars = max;
        }
        config.max_chars = config.max_chars * share / 100;
        let (graph, git, findings) = entry.services();
        let provider = Arc::new(
            RepositoryContextProvider::new(graph)
                .with_git(git)
                .with_findings(findings)
                .with_focus(Arc::new(StaticFocus(focus)))
                .with_task(
                    self.spec
                        .task
                        .as_deref()
                        .map(TaskKind::from_profile)
                        .unwrap_or_default(),
                )
                .with_config(config)
                .with_observer(Arc::new(InjectionLog {
                    directory: workspace.join(".rusty/observability/context"),
                    repository: repo.id.clone(),
                })),
        );
        if let Ok(mut providers) = self.providers.lock() {
            providers.insert(key, provider.clone());
        }
        provider
    }

    /// Indexes a repository in the background, once at a time per repository.
    fn index_in_background(&self, repo: &RepoRef, entry: Arc<Entry>) {
        let Ok(mut running) = self.indexing.lock() else {
            return;
        };
        if !running.insert(repo.id.clone()) {
            return;
        }
        let (id, running) = (repo.id.clone(), self.indexing.clone());
        tokio::spawn(async move {
            let _ = entry.refresh(false).await;
            if let Ok(mut running) = running.lock() {
                running.remove(&id);
            }
        });
    }

    fn map(&self, repos: &[RepoRef], involved: &[RepoRef]) -> String {
        let mut ordered: Vec<&RepoRef> = involved.iter().collect();
        ordered.extend(
            repos
                .iter()
                .filter(|r| !involved.iter().any(|i| i.id == r.id)),
        );
        let mut out = String::from("Workspace repositories (documentation is kept per repository; pass `repository` to repo_context or repo_wiki to choose one):\n");
        let mut shown = 0;
        for repo in ordered.into_iter().take(MAP_REPOSITORIES) {
            let line = format!(
                "- {} ({}{})\n",
                repo.name,
                if repo.relative.is_empty() {
                    "."
                } else {
                    &repo.relative
                },
                repo.branch
                    .as_ref()
                    .map(|b| format!(", {b}"))
                    .unwrap_or_default()
            );
            if out.chars().count() + line.chars().count() > MAP_CHARS {
                break;
            }
            out.push_str(&line);
            shown += 1;
        }
        if shown < repos.len() {
            out.push_str(&format!("- … {} more\n", repos.len() - shown));
        }
        out.trim_end().to_owned()
    }
}

/// The text of the most recent user message.
fn latest_user_text(request: &ExecutionRequest) -> String {
    request
        .messages
        .iter()
        .rev()
        .find(|m| m.role == MessageRole::User)
        .map(|m| {
            m.content
                .iter()
                .filter_map(|b| {
                    if let ContentBlock::Text { text } = b {
                        Some(text.as_str())
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

/// The request with paths in its last user message made relative to `repo`.
fn rewritten(request: &ExecutionRequest, repo: &RepoRef) -> ExecutionRequest {
    let mut request = request.clone();
    let prefixes: Vec<String> = [
        format!("{}/", repo.root.display()),
        if repo.relative.is_empty() {
            String::new()
        } else {
            format!("{}/", repo.relative)
        },
    ]
    .into_iter()
    .filter(|p| !p.is_empty())
    .collect();
    if let Some(message) = request
        .messages
        .iter_mut()
        .rev()
        .find(|m| m.role == MessageRole::User)
    {
        for block in &mut message.content {
            if let ContentBlock::Text { text } = block {
                for prefix in &prefixes {
                    *text = text.replace(prefix.as_str(), "");
                }
            }
        }
    }
    request
}

#[async_trait]
impl ContextProvider for WorkspaceContextProvider {
    async fn assemble(
        &self,
        request: ExecutionRequest,
        workspace: &dyn Workspace,
    ) -> ExecutionRequest {
        let Ok(repos) = self.state.directory().repositories(&self.workspace) else {
            return request;
        };
        let Ok(root) = std::fs::canonicalize(&self.workspace) else {
            return request;
        };
        let message = latest_user_text(&request);
        let involved = self.involved(&repos, &root, &message);
        let mut sections: Vec<String> = Vec::new();
        if repos.len() > 1 {
            sections.push(self.map(&repos, &involved));
        }
        let documented = involved.len().max(1);
        for (index, repo) in involved.iter().enumerate() {
            let Ok(entry) = self.state.entry(&repo.root.to_string_lossy()) else {
                continue;
            };
            if entry.snapshot().is_err() {
                self.index_in_background(repo, entry);
                continue;
            }
            let primary = index == 0;
            let share = if documented == 1 {
                100
            } else if primary {
                PRIMARY_SHARE
            } else {
                (100 - PRIMARY_SHARE) / (documented - 1)
            };
            let provider = self.provider_for(repo, &repos, &root, &entry, primary, share);
            let sub = rewritten(&request, repo);
            let before = sub.system_prompt.clone();
            let after = provider.assemble(sub, workspace).await.system_prompt;
            let added = after
                .strip_prefix(&before)
                .unwrap_or(&after)
                .trim_start_matches("\n\n");
            if !added.is_empty() {
                sections.push(if repos.len() > 1 {
                    format!(
                        "Documentation for repository `{}` ({}):\n{added}",
                        repo.name,
                        if repo.relative.is_empty() {
                            "."
                        } else {
                            &repo.relative
                        }
                    )
                } else {
                    added.to_owned()
                });
            }
        }
        let mut request = request;
        if !sections.is_empty() {
            let block = sections.join("\n\n");
            request.system_prompt = if request.system_prompt.is_empty() {
                block
            } else {
                format!("{}\n\n{block}", request.system_prompt)
            };
        }
        request
    }
}

/// Appends one JSON line per request to `.rusty/observability/context/<date>.jsonl`, so what the
/// model was given can be measured later. Best effort: a write failure never affects the run.
struct InjectionLog {
    directory: PathBuf,
    repository: String,
}

impl ContextObserver for InjectionLog {
    fn injected(&self, report: &InjectionReport) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_secs());
        let line = json!({
            "at": now,
            "repository": self.repository,
            "snapshot": report.snapshot,
            "conversation": report.conversation,
            "run": report.run,
            "abstained": report.abstained,
            "brief_chars": report.brief_chars,
            "retrieved_chars": report.retrieved_chars,
            "dropped": report.dropped,
            "unchanged": report.unchanged,
            "pages": report.pages.iter().map(|p| json!({"page": p.page, "tier": p.tier, "reason": p.reason, "chars": p.chars, "excerpt": p.excerpt})).collect::<Vec<_>>(),
        });
        let _ = append(&self.directory, &date(now), &line.to_string());
    }
}

fn append(directory: &Path, date: &str, line: &str) -> std::io::Result<()> {
    std::fs::create_dir_all(directory)?;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(directory.join(format!("{date}.jsonl")))?;
    writeln!(file, "{line}")
}

/// `YYYY-MM-DD` (UTC) of a Unix time, without a date library.
fn date(seconds: u64) -> String {
    let days = (seconds / 86_400) as i64 + 719_468;
    let era = days.div_euclid(146_097);
    let day_of_era = days.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * shifted + 2) / 5 + 1;
    let month = if shifted < 10 {
        shifted + 3
    } else {
        shifted - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_are_civil_utc() {
        assert_eq!(date(0), "1970-01-01");
        assert_eq!(date(951_782_400), "2000-02-29");
        assert_eq!(date(1_760_745_600), "2025-10-18");
    }

    #[test]
    fn the_log_appends_one_line_per_request() {
        let directory = tempfile::tempdir().unwrap();
        let log = InjectionLog {
            directory: directory.path().join("context"),
            repository: "/ws/api".into(),
        };
        let report = InjectionReport {
            snapshot: "s".into(),
            conversation: "c".into(),
            run: "r".into(),
            abstained: false,
            brief_chars: 1,
            retrieved_chars: 2,
            dropped: 0,
            unchanged: 0,
            pages: vec![],
        };
        log.injected(&report);
        log.injected(&report);
        let file = std::fs::read_dir(directory.path().join("context"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let text = std::fs::read_to_string(file).unwrap();
        assert_eq!(text.lines().count(), 2);
        assert!(
            serde_json::from_str::<serde_json::Value>(text.lines().next().unwrap()).unwrap()
                ["retrieved_chars"]
                == 2
        );
    }

    #[test]
    fn the_spec_is_on_by_default_and_names_the_work() {
        let spec: RepositoryContextSpec =
            serde_json::from_value(json!({"active_file": "src/a.rs", "task": "refactor"})).unwrap();
        assert!(spec.enabled && spec.touched.is_empty());
        let off: RepositoryContextSpec = serde_json::from_value(json!({"enabled": false})).unwrap();
        assert!(!off.enabled);
    }
}
