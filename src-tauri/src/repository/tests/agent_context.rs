//! `repo_context` as an agent calls it: builds what is missing, refreshes a stale answer once,
//! and reports an unsupported language instead of failing.
use serde_json::json;

use super::{ready, write, write_fixture, Entry};

#[tokio::test]
async fn it_builds_the_snapshot_when_none_exists() {
    let dir = tempfile::tempdir().unwrap();
    write_fixture(dir.path());
    let entry = Entry::new(dir.path()).unwrap();
    assert!(entry.open_response().snapshot.is_none());
    let output = entry
        .agent_context(json!({"target": "src/a.rs"}))
        .await
        .unwrap();
    assert_eq!(output["result"]["status"], "ok", "{output}");
    assert_eq!(output["result"]["target"]["language"], "rust");
    assert!(entry.open_response().snapshot.is_some());
}

#[tokio::test]
async fn a_stale_answer_triggers_one_refresh_and_is_asked_again() {
    let (dir, entry) = ready().await;
    write(
        dir.path(),
        "src/a.rs",
        "use crate::b::B;\npub struct A;\n// edited\n",
    );
    let output = entry
        .agent_context(json!({"target": "src/a.rs"}))
        .await
        .unwrap();
    assert_eq!(
        output["result"]["status"], "ok",
        "refreshed, so no longer stale: {output}"
    );
    // A file added since the snapshot is picked up the same way.
    write(dir.path(), "src/new.rs", "pub struct N;\n");
    let added = entry
        .agent_context(json!({"target": "src/new.rs"}))
        .await
        .unwrap();
    assert_eq!(added["result"]["status"], "ok", "{added}");
}

#[tokio::test]
async fn unsupported_languages_and_bad_requests_are_reported_through_the_same_channel() {
    let (dir, entry) = ready().await;
    write(dir.path(), "scripts/tool.rb", "puts 1\n");
    let output = entry
        .agent_context(json!({"target": "scripts/tool.rb"}))
        .await
        .unwrap();
    assert_eq!(output["result"]["status"], "unsupported");
    assert_eq!(output["result"]["target"]["language"], "Ruby");
    let error = entry
        .agent_context(json!({"target": "src/a.rs", "depth": 9}))
        .await
        .unwrap_err();
    assert_eq!(error.code, "limit_exceeded");
    let blast = entry
        .agent_context(json!({"target": "src/a.rs", "mode": "blast_radius"}))
        .await
        .unwrap();
    assert!(
        blast["result"]["sections"]["affected"]["files"]
            .as_u64()
            .unwrap()
            >= 3
    );
    assert!(
        blast["result"]["sections"]["co_change_hints"].is_object(),
        "Git history is used when the workspace has it"
    );
}

#[tokio::test]
async fn the_wiki_is_available_to_the_docs_tab_and_to_agents() {
    let (_dir, entry) = ready().await;
    let page = entry.wiki_page("file:src/a.rs").unwrap();
    assert_eq!(page.title, "src/a.rs");
    assert!(page.sections.iter().any(|s| s.key == "imports"));
    let children = entry.wiki_children("repo:").unwrap();
    assert!(!children.is_empty());
    assert_eq!(
        entry.wiki_page("bogus:x").unwrap_err().code,
        "invalid_request"
    );

    let output = entry
        .agent_tool("repo_wiki", json!({"target": "src/a.rs"}))
        .await
        .unwrap();
    assert_eq!(output["result"]["level"], "file");
    assert!(output["result"]["markdown"]
        .as_str()
        .unwrap()
        .contains("## Imports"));

    // With no snapshot the tool builds one; the plain page command asks for a refresh.
    let dir = tempfile::tempdir().unwrap();
    write_fixture(dir.path());
    let fresh = Entry::new(dir.path()).unwrap();
    assert_eq!(
        fresh.wiki_page("repo:").unwrap_err().code,
        "snapshot_not_found"
    );
    let built = fresh
        .agent_tool("repo_wiki", json!({"target": ""}))
        .await
        .unwrap();
    assert_eq!(built["result"]["level"], "repository");
}
