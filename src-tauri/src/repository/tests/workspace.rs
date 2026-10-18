//! A workspace folder with several repositories: every call and every request goes to the
//! repository it is about.
use std::sync::Arc;

use harness_context::ContextProvider;
use harness_protocol::{
    backend::ExecutionRequest,
    ids::{MessageId, RequestId, RunId, Timestamp},
    messages::{AgentMessage, ContentBlock, MessageRole},
};
use serde_json::json;

use super::{write, write_fixture};
use crate::{
    harness::repository_context::{providers, RepositoryContextSpec},
    repository::{
        directory::{RepoRef, RepositoryDirectory},
        registry::{RepositoryState, MAX_LOADED},
        routing::run_tool,
    },
};

/// A workspace folder holding `api` and `web`, each a copy of the fixture repository.
struct World {
    dir: tempfile::TempDir,
    state: RepositoryState,
}

fn repo(workspace: &std::path::Path, relative: &str) -> RepoRef {
    let root = std::fs::canonicalize(workspace.join(relative)).unwrap();
    RepoRef {
        id: root.to_string_lossy().into_owned(),
        name: relative.to_owned(),
        root,
        relative: relative.to_owned(),
        kind: "workspace".into(),
        branch: Some("main".into()),
    }
}

fn world(names: &[&str]) -> World {
    let dir = tempfile::tempdir().unwrap();
    for name in names {
        write_fixture(&dir.path().join(name));
        // The repositories differ, so an answer shows which one it came from.
        write(
            &dir.path().join(name),
            "src/own.rs",
            &format!("// belongs to {name}\npub struct Own;\n"),
        );
    }
    let workspace = dir.path().to_path_buf();
    let names: Vec<String> = names.iter().map(|n| (*n).to_owned()).collect();
    let directory = RepositoryDirectory::with(Box::new(move |_| {
        Ok(names.iter().map(|n| repo(&workspace, n)).collect())
    }));
    World {
        dir,
        state: RepositoryState::with_directory(directory),
    }
}

impl World {
    fn root(&self) -> String {
        self.dir.path().to_string_lossy().into_owned()
    }

    async fn index(&self, name: &str) {
        self.state
            .entry(&self.dir.path().join(name).to_string_lossy())
            .unwrap()
            .refresh(false)
            .await
            .unwrap();
    }

    async fn call(
        &self,
        active: Option<&str>,
        tool: &str,
        arguments: serde_json::Value,
    ) -> Result<serde_json::Value, crate::repository::error::RepositoryError> {
        run_tool(&self.state, &self.root(), active, tool, arguments).await
    }
}

#[tokio::test]
async fn a_path_sends_the_call_to_the_repository_that_holds_it_and_the_answer_says_which() {
    let world = world(&["api", "web"]);
    let output = world
        .call(None, "repo_context", json!({"target": "web/src/a.rs"}))
        .await
        .unwrap();
    assert_eq!(output["repository"]["name"], "web");
    assert_eq!(
        output["result"]["target"]["path"], "src/a.rs",
        "paths in the answer are relative to the repository"
    );
    assert_eq!(output["result"]["status"], "ok");
    // The calls it suggests keep the repository, so following them stays there.
    let next = output["result"]["next"].as_array().unwrap();
    assert!(
        !next.is_empty()
            && next.iter().all(|call| call["arguments"]["repository"]
                .as_str()
                .unwrap()
                .ends_with("/web")),
        "{next:?}"
    );
    // Only the repository that was asked about was loaded and indexed.
    assert!(
        world.state.peek(&world.dir.path().join("web")).is_some()
            && world.state.peek(&world.dir.path().join("api")).is_none()
    );
}

#[tokio::test]
async fn an_explicit_repository_wins_and_a_qualified_page_id_names_one() {
    let world = world(&["api", "web"]);
    let output = world
        .call(
            None,
            "repo_context",
            json!({"target": "src/own.rs", "repository": "api"}),
        )
        .await
        .unwrap();
    assert_eq!(output["repository"]["name"], "api");
    assert_eq!(output["result"]["status"], "ok");
    let page = world
        .call(None, "repo_wiki", json!({"target": "web#file:src/own.rs"}))
        .await
        .unwrap();
    assert_eq!(page["repository"]["name"], "web");
    assert!(page["result"]["markdown"]
        .as_str()
        .unwrap()
        .contains("src/own.rs"));
    assert_eq!(
        world
            .call(
                None,
                "repo_wiki",
                json!({"target": "src/a.rs", "repository": "nope"})
            )
            .await
            .unwrap_err()
            .code,
        "unknown_repository"
    );
}

#[tokio::test]
async fn a_call_that_does_not_say_which_repository_fails_instead_of_guessing() {
    let world = world(&["api", "web"]);
    let error = world
        .call(None, "repo_wiki", json!({"target": ""}))
        .await
        .unwrap_err();
    assert_eq!(error.code, "ambiguous_repository");
    assert!(
        error.message.contains("api") && error.message.contains("web"),
        "{}",
        error.message
    );
    // The repository chosen in the IDE decides when nothing else does.
    let active = world.dir.path().join("api").canonicalize().unwrap();
    let output = world
        .call(
            Some(&active.to_string_lossy()),
            "repo_wiki",
            json!({"target": ""}),
        )
        .await
        .unwrap();
    assert_eq!(output["repository"]["name"], "api");
}

#[tokio::test]
async fn paths_in_different_repositories_need_one_call_each() {
    let world = world(&["api", "web"]);
    let error = world
        .call(
            None,
            "repo_context",
            json!({"mode": "changes", "targets": ["api/src/a.rs", "web/src/a.rs"]}),
        )
        .await
        .unwrap_err();
    assert_eq!(error.code, "spans_repositories");
    let output = world
        .call(
            None,
            "repo_context",
            json!({"mode": "changes", "targets": ["web/src/a.rs", "web/src/b.rs"]}),
        )
        .await
        .unwrap();
    assert_eq!(output["repository"]["name"], "web");
    assert_eq!(
        output["result"]["sections"]["changed"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

#[tokio::test]
async fn a_single_repository_workspace_behaves_as_before() {
    let world = world(&["only"]);
    let output = world
        .call(None, "repo_context", json!({"target": "src/a.rs"}))
        .await
        .unwrap();
    assert_eq!(output["repository"]["name"], "only");
    let rooted = world
        .call(None, "repo_wiki", json!({"target": ""}))
        .await
        .unwrap();
    assert_eq!(rooted["result"]["level"], "repository");
}

#[tokio::test]
async fn only_a_few_indexes_are_kept_and_indexing_shares_one_limit() {
    let names: Vec<String> = (0..MAX_LOADED + 3).map(|i| format!("repo{i:02}")).collect();
    let names: Vec<&str> = names.iter().map(String::as_str).collect();
    let world = world(&names);
    let path = |name: &str| world.dir.path().join(name).to_string_lossy().into_owned();
    let (first, second) = (
        world.state.entry(&path(names[0])).unwrap(),
        world.state.entry(&path(names[1])).unwrap(),
    );
    assert!(
        Arc::ptr_eq(&first.indexing, &second.indexing),
        "one limit for every repository"
    );
    drop((first, second));
    for name in &names[2..] {
        world.state.entry(&path(name)).unwrap();
    }
    assert_eq!(world.state.loaded(), MAX_LOADED);
    assert!(
        world.state.peek(&world.dir.path().join("repo00")).is_none(),
        "the least recently used is dropped"
    );
    assert!(world
        .state
        .peek(&world.dir.path().join(names[names.len() - 1]))
        .is_some());
    // An index that is in use is never dropped from under its caller.
    let held = world.state.entry(&path("repo03")).unwrap();
    for name in &names[..3] {
        world.state.entry(&path(name)).unwrap();
    }
    assert!(world.state.peek(&world.dir.path().join("repo03")).is_some());
    assert_eq!(Arc::strong_count(&held), 2, "the registry and this caller");
}

#[tokio::test]
async fn the_overview_lists_repositories_and_whether_each_is_indexed_without_loading_any() {
    let world = world(&["api", "web"]);
    let before =
        crate::repository::overview::workspace_overview(&world.state, &world.root()).unwrap();
    assert_eq!(
        before
            .iter()
            .map(|r| (r.name.as_str(), r.indexed))
            .collect::<Vec<_>>(),
        [("api", false), ("web", false)]
    );
    assert_eq!(world.state.loaded(), 0);
    world.index("web").await;
    let after =
        crate::repository::overview::workspace_overview(&world.state, &world.root()).unwrap();
    let web = after.iter().find(|r| r.name == "web").unwrap();
    assert!(web.indexed && web.files >= 6 && web.built_at_ms.is_some());
    assert!(!after.iter().find(|r| r.name == "api").unwrap().indexed);
    assert_eq!(world.state.loaded(), 1);
}

fn request(text: &str) -> ExecutionRequest {
    ExecutionRequest {
        request_id: RequestId::new(),
        run_id: RunId::new(),
        system_prompt: String::new(),
        messages: vec![AgentMessage {
            id: MessageId::new(),
            role: MessageRole::User,
            content: vec![ContentBlock::Text {
                text: text.to_owned(),
            }],
            created_at: Timestamp::now(),
        }],
        tools: vec![],
        extended_thinking: false,
        params: Default::default(),
    }
}

async fn assemble(world: &World, spec: serde_json::Value, system: &str, text: &str) -> String {
    let spec: RepositoryContextSpec = serde_json::from_value(spec).unwrap();
    let chain = harness_context::ChainedContextProvider::new(providers(
        Some(system.to_owned()),
        Some(&spec),
        Some(&world.state),
        &world.root(),
    ));
    chain
        .assemble(
            request(text),
            &harness_runtime::workspace::FakeWorkspace::new(),
        )
        .await
        .system_prompt
}

#[tokio::test]
async fn a_request_gets_the_documentation_of_each_repository_it_names_and_a_map_of_the_workspace() {
    let world = world(&["api", "web", "tools"]);
    world.index("api").await;
    world.index("web").await;
    let prompt = assemble(
        &world,
        json!({"task": "refactor"}),
        "base prompt",
        "move web/src/a.rs next to api/src/b.rs",
    )
    .await;
    assert!(
        prompt.starts_with("base prompt\n\nWorkspace repositories"),
        "{prompt}"
    );
    assert!(
        prompt.contains("- web (web, main)") && prompt.contains("- tools (tools, main)"),
        "all repositories are in the map"
    );
    let web = prompt
        .find("Documentation for repository `web`")
        .expect("web is documented");
    let api = prompt
        .find("Documentation for repository `api`")
        .expect("api is documented");
    assert!(web < api, "the repository named first is the primary one");
    assert!(
        prompt.contains("### file:src/a.rs — you mentioned `src/a.rs`"),
        "paths are relative to their repository: {prompt}"
    );
    assert!(
        prompt.matches("Repository overview").count() == 1,
        "only the primary repository gets the overview"
    );
    assert!(
        !prompt.contains("Documentation for repository `tools`"),
        "a repository nothing points at is left alone"
    );
}

#[tokio::test]
async fn a_repository_that_is_not_indexed_yet_is_indexed_for_the_next_request_and_nothing_else_is()
{
    let world = world(&["api", "web", "tools"]);
    let first = assemble(&world, json!({}), "", "look at web/src/a.rs").await;
    assert!(
        !first.contains("Documentation for repository `web`"),
        "nothing to read yet"
    );
    assert!(
        first.starts_with("Workspace repositories"),
        "the map needs no index"
    );
    for _ in 0..100 {
        if world
            .state
            .peek(&world.dir.path().join("web"))
            .is_some_and(|e| e.snapshot().is_ok())
        {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    let second = assemble(&world, json!({}), "", "look at web/src/a.rs").await;
    assert!(
        second.contains("Documentation for repository `web`")
            && second.contains("### file:src/a.rs"),
        "{second}"
    );
    assert!(
        world.state.peek(&world.dir.path().join("api")).is_none(),
        "repositories nothing named were never loaded"
    );
}

#[tokio::test]
async fn a_request_that_names_nothing_gets_only_the_map_and_the_chosen_repository_when_there_is_one(
) {
    let world = world(&["api", "web"]);
    world.index("api").await;
    let nothing = assemble(&world, json!({}), "base", "how does authentication work?").await;
    assert!(
        nothing.starts_with("base\n\nWorkspace repositories")
            && !nothing.contains("Documentation for repository"),
        "{nothing}"
    );
    let chosen = world
        .dir
        .path()
        .join("api")
        .canonicalize()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let with_active = assemble(
        &world,
        json!({"active_repository": chosen}),
        "base",
        "how does authentication work?",
    )
    .await;
    assert!(
        with_active.contains("Documentation for repository `api`")
            && with_active.contains("Repository overview"),
        "{with_active}"
    );
    let off = assemble(&world, json!({"enabled": false}), "base", "web/src/a.rs").await;
    assert_eq!(off, "base");
}
