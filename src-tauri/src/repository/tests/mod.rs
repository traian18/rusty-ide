//! Tests run against real fixture repositories through [`Entry`], the same code the Tauri commands call.
use std::path::Path;

use git2::{IndexAddOption, Repository, Signature, Time};
use harness_workspace::dependency_groups::{GraphDirection, GroupKind, Truncation};

mod agent_context;
mod background;
mod dashboard;
mod documentation;
mod frameworks;
mod health;
mod levels;
mod workspace;

use super::{
    dto::{
        EdgeDirection, EdgesRequest, FindingsRequest, GroupGraphRequest, MembersRequest,
        NeighbourhoodRequest, NodesExistRequest, OverviewRequest,
    },
    entry::Entry,
    persisted_state,
    registry::RepositoryState,
};

fn write(root: &Path, relative: &str, text: &str) {
    let full = root.join(relative);
    std::fs::create_dir_all(full.parent().unwrap()).unwrap();
    std::fs::write(full, text).unwrap();
}

/// A crate with an import cycle (a <-> b), a dependent (c), and an unreferenced TypeScript file.
fn write_fixture(root: &Path) {
    write(
        root,
        "Cargo.toml",
        "[package]\nname = \"app\"\nversion = \"0.1.0\"\n",
    );
    write(root, "src/lib.rs", "pub mod a;\npub mod b;\npub mod c;\n");
    write(root, "src/a.rs", "use crate::b::B;\npub struct A;\n");
    write(root, "src/b.rs", "use crate::a::A;\npub struct B;\n");
    write(root, "src/c.rs", "use crate::a::A;\n");
    write(
        root,
        "web/package.json",
        r#"{"name":"web","types":"src/index.ts"}"#,
    );
    write(root, "web/src/index.ts", "export const i = 1;\n");
    write(root, "web/src/dead.ts", "export const dead = 1;\n");
}

fn commit_history(root: &Path) {
    let repo = Repository::init(root).unwrap();
    for round in 0..4 {
        for file in ["src/a.rs", "src/b.rs"] {
            let existing = std::fs::read_to_string(root.join(file)).unwrap();
            write(root, file, &format!("{existing}// {round}\n"));
        }
        let mut index = repo.index().unwrap();
        index.add_all(["."], IndexAddOption::DEFAULT, None).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let who = Signature::new(
            "Alice",
            "alice@example.com",
            &Time::new(1_700_000_000 + round * 86_400, 0),
        )
        .unwrap();
        let parents = repo
            .head()
            .ok()
            .and_then(|h| h.peel_to_commit().ok())
            .into_iter()
            .collect::<Vec<_>>();
        repo.commit(
            Some("HEAD"),
            &who,
            &who,
            "change",
            &tree,
            &parents.iter().collect::<Vec<_>>(),
        )
        .unwrap();
    }
}

fn overview(kind: GroupKind) -> OverviewRequest {
    OverviewRequest {
        kind,
        node_limit: None,
        edge_limit: None,
        import_kind: None,
    }
}

async fn ready() -> (tempfile::TempDir, Entry) {
    let dir = tempfile::tempdir().unwrap();
    write_fixture(dir.path());
    commit_history(dir.path());
    let entry = Entry::new(dir.path()).unwrap();
    entry.refresh(true).await.unwrap();
    (dir, entry)
}

#[tokio::test]
async fn nothing_is_available_before_the_first_refresh() {
    let dir = tempfile::tempdir().unwrap();
    write_fixture(dir.path());
    let entry = Entry::new(dir.path()).unwrap();
    let open = entry.open_response();
    assert!(
        open.snapshot.is_none()
            && open.git.is_none()
            && open.findings.is_none()
            && open.built_at_ms.is_none()
    );
    assert_eq!(
        entry
            .overview(overview(GroupKind::DeclaredPackage))
            .unwrap_err()
            .code,
        "snapshot_not_found"
    );
    assert_eq!(entry.freshness().unwrap_err().code, "snapshot_not_found");
    assert_eq!(
        entry
            .group_graph(GroupGraphRequest {
                group: "x".into(),
                node_limit: None,
                edge_limit: None
            })
            .unwrap_err()
            .code,
        "snapshot_not_found"
    );
    assert_eq!(
        entry.findings(findings_request()).unwrap_err().code,
        "snapshot_not_found"
    );
    assert!(entry.git_file("src/a.rs").unwrap().is_none());
}

fn findings_request() -> FindingsRequest {
    FindingsRequest {
        rules: vec![],
        kind: None,
        min_severity: None,
        min_confidence: None,
        package: None,
        file: None,
        include_suppressed: false,
        cursor: None,
        limit: None,
    }
}

#[tokio::test]
async fn refresh_builds_snapshot_git_and_findings_and_the_open_response_reflects_them() {
    let (_dir, entry) = ready().await;
    let open = entry.open_response();
    let snapshot = open.snapshot.unwrap();
    assert_eq!((snapshot.packages, snapshot.files), (2, 6));
    assert_eq!(snapshot.languages, vec!["rust", "typescript"]);
    assert!(snapshot.groups_configured && !snapshot.partial);
    assert_eq!(open.git.unwrap().commits_used, 4);
    let findings = open.findings.unwrap();
    assert!(findings.summary.by_rule.contains_key("import-cycle"));
    assert!(open.built_at_ms.is_some());
}

#[tokio::test]
async fn overview_drill_down_and_neighbourhood_come_from_the_core_contracts() {
    let (_dir, entry) = ready().await;
    let overview_result = entry
        .overview(overview(GroupKind::DeclaredPackage))
        .unwrap();
    assert_eq!(overview_result.nodes.len(), 2);

    let cycle_group = "import_cycle:src/a.rs";
    let graph = entry
        .group_graph(GroupGraphRequest {
            group: cycle_group.into(),
            node_limit: None,
            edge_limit: None,
        })
        .unwrap();
    assert_eq!(
        graph
            .nodes
            .iter()
            .map(|n| n.file.as_str())
            .collect::<Vec<_>>(),
        vec!["src/a.rs", "src/b.rs"]
    );
    assert_eq!(graph.edges.len(), 2);
    assert_eq!(
        graph.boundary.incoming, 3,
        "c.rs and lib.rs import into the cycle"
    );
    assert_eq!(graph.truncation, Truncation::None);

    let package = "declared_package:Cargo.toml:app";
    let limited = entry
        .group_graph(GroupGraphRequest {
            group: package.into(),
            node_limit: Some(2),
            edge_limit: None,
        })
        .unwrap();
    assert_eq!(
        (
            limited.nodes.len(),
            limited.total_members,
            limited.truncation
        ),
        (2, 4, Truncation::NodeLimit)
    );
    let capped = entry
        .group_graph(GroupGraphRequest {
            group: package.into(),
            node_limit: None,
            edge_limit: Some(1),
        })
        .unwrap();
    assert_eq!(
        (capped.edges.len(), capped.truncation),
        (1, Truncation::EdgeLimit)
    );
    assert_eq!(
        entry
            .group_graph(GroupGraphRequest {
                group: "nope".into(),
                node_limit: None,
                edge_limit: None
            })
            .unwrap_err()
            .code,
        "unknown_group"
    );
    assert_eq!(
        entry
            .group_graph(GroupGraphRequest {
                group: package.into(),
                node_limit: Some(0),
                edge_limit: None
            })
            .unwrap_err()
            .code,
        "limit_exceeded"
    );

    let members = entry
        .members(MembersRequest {
            group: package.into(),
            cursor: None,
            limit: Some(2),
        })
        .unwrap();
    assert_eq!(members.members.len(), 2);
    assert!(members.next_cursor.is_some());

    let around = entry
        .neighbourhood(NeighbourhoodRequest {
            files: vec!["src/c.rs".into()],
            direction: GraphDirection::Dependencies,
            depth: 2,
            node_limit: None,
            edge_limit: None,
            import_kind: None,
        })
        .unwrap();
    assert!(around
        .nodes
        .iter()
        .any(|n| n.file.as_path().ends_with("b.rs")));
    assert_eq!(
        entry
            .neighbourhood(NeighbourhoodRequest {
                files: vec!["../x".into()],
                direction: GraphDirection::Both,
                depth: 1,
                node_limit: None,
                edge_limit: None,
                import_kind: None
            })
            .unwrap_err()
            .code,
        "invalid_request"
    );

    let imports = entry
        .edges(EdgesRequest {
            file: "src/c.rs".into(),
            direction: EdgeDirection::Imports,
            cursor: None,
            limit: None,
        })
        .unwrap();
    assert_eq!(imports.edges.len(), 1);
    let importers = entry
        .edges(EdgesRequest {
            file: "src/a.rs".into(),
            direction: EdgeDirection::Importers,
            cursor: None,
            limit: None,
        })
        .unwrap();
    assert_eq!(importers.edges.len(), 3);
    assert_eq!(
        entry
            .edges(EdgesRequest {
                file: "src/zzz.rs".into(),
                direction: EdgeDirection::Imports,
                cursor: None,
                limit: None
            })
            .unwrap_err()
            .code,
        "unknown_file"
    );
    assert_eq!(entry.groups_of("src/a.rs").unwrap().len(), 3);
}

#[tokio::test]
async fn findings_badges_and_git_facts_describe_the_same_files() {
    let (_dir, entry) = ready().await;
    let page = entry.findings(findings_request()).unwrap();
    let cycle = page
        .entries
        .iter()
        .find(|e| e.finding.id.0 == "import-cycle:src/a.rs")
        .expect("the cycle is reported");
    assert_eq!(cycle.finding.locations[0].line, Some(1));
    let explained = entry.finding_explain("import-cycle:src/a.rs").unwrap();
    assert_eq!(explained.import_sites.len(), 2);
    assert_eq!(
        entry.finding_explain("nope:none").unwrap_err().code,
        "finding_not_found"
    );

    let badges = entry.finding_badges().unwrap();
    assert!(badges.finding_set.is_some());
    assert_eq!(
        badges.by_file["src/a.rs"].medium, 1,
        "only the cycle touches a.rs"
    );
    assert_eq!(badges.by_group["import_cycle:src/a.rs"].medium, 1);
    assert!(badges.by_group["declared_package:Cargo.toml:app"].medium >= 1);
    assert!(
        badges.by_file["web/src/dead.ts"].low >= 1,
        "the unreferenced candidate"
    );

    let git = entry.git_file("src/a.rs").unwrap().unwrap();
    assert_eq!(git.churn.unwrap().commits, 4);
    assert_eq!(
        git.co_changed[0].partner.as_path().to_str(),
        Some("src/b.rs")
    );
    assert_eq!(git.contributors[0].contributor.name, "Alice");
    assert!(git.interpretation.contains("not show causation"));
    let quiet = entry.git_file("src/c.rs").unwrap().unwrap();
    assert_eq!(quiet.churn.unwrap().commits, 1);
    assert!(
        quiet.co_changed.is_empty(),
        "one commit is below the co-change support threshold"
    );
}

#[tokio::test]
async fn a_directory_without_git_history_still_gets_structure_and_findings() {
    let dir = tempfile::tempdir().unwrap();
    write_fixture(dir.path());
    let entry = Entry::new(dir.path()).unwrap();
    let refreshed = entry.refresh(true).await.unwrap();
    assert!(refreshed.git.is_none());
    assert_eq!(refreshed.stage_errors.len(), 1);
    assert_eq!(
        (
            refreshed.stage_errors[0].stage.as_str(),
            refreshed.stage_errors[0].code.as_str()
        ),
        ("git", "not_a_git_repository")
    );
    assert!(
        refreshed.findings.is_some(),
        "findings run without Git, skipping the Git rules"
    );
    assert!(entry.git_file("src/a.rs").unwrap().is_none());
    // Skipping Git on request is not an error.
    let skipped = entry.refresh(false).await.unwrap();
    assert!(skipped.git.is_none() && skipped.stage_errors.is_empty());
}

#[tokio::test]
async fn freshness_reports_changed_and_missing_files_without_scanning() {
    let (dir, entry) = ready().await;
    let fresh = entry.freshness().unwrap();
    assert!(fresh.changed.is_empty() && fresh.missing.is_empty());
    assert!(fresh.checked >= 6);

    std::thread::sleep(std::time::Duration::from_millis(30));
    write(dir.path(), "src/c.rs", "use crate::a::A;\n// edited\n");
    std::fs::remove_file(dir.path().join("web/src/dead.ts")).unwrap();
    write(dir.path(), "src/brand_new.rs", "pub fn n() {}\n");
    let stale = entry.freshness().unwrap();
    assert_eq!(stale.changed, vec!["src/c.rs"]);
    assert_eq!(stale.missing, vec!["web/src/dead.ts"]);
    assert!(
        !stale.changed.iter().any(|f| f.contains("brand_new")),
        "new files appear only after a refresh"
    );

    entry.refresh(false).await.unwrap();
    let after = entry.freshness().unwrap();
    assert!(after.changed.is_empty() && after.missing.is_empty());
}

#[tokio::test]
async fn services_are_isolated_per_workspace_root_and_shared_across_spellings() {
    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();
    write_fixture(first.path());
    write_fixture(second.path());
    let state = RepositoryState::new();
    let a = state.entry(first.path().to_str().unwrap()).unwrap();
    let b = state.entry(second.path().to_str().unwrap()).unwrap();
    assert!(!std::sync::Arc::ptr_eq(&a, &b));
    a.refresh(false).await.unwrap();
    assert!(a.open_response().snapshot.is_some());
    assert!(
        b.open_response().snapshot.is_none(),
        "refreshing one workspace does not touch another"
    );

    let dotted = format!("{}/.", first.path().display());
    assert!(std::sync::Arc::ptr_eq(&a, &state.entry(&dotted).unwrap()));
    state.close(first.path().to_str().unwrap());
    let reopened = state.entry(first.path().to_str().unwrap()).unwrap();
    assert!(
        reopened.open_response().snapshot.is_none(),
        "closing drops the snapshots"
    );
    assert_eq!(
        state
            .entry("/definitely/not/a/directory")
            .err()
            .unwrap()
            .code,
        "invalid_request"
    );
}

#[tokio::test]
async fn cancelling_before_a_refresh_does_not_poison_it() {
    let dir = tempfile::tempdir().unwrap();
    write_fixture(dir.path());
    let entry = Entry::new(dir.path()).unwrap();
    entry.cancel_refresh();
    entry.cancel_refresh();
    entry
        .refresh(false)
        .await
        .expect("a new refresh gets a new token");
    assert!(entry.open_response().snapshot.is_some());
}

#[test]
fn saved_state_round_trips_atomically_and_rejects_bad_documents() {
    let data = tempfile::tempdir().unwrap();
    let root_a = tempfile::tempdir().unwrap();
    let root_b = tempfile::tempdir().unwrap();
    let path_a = persisted_state::state_path(data.path(), root_a.path());
    assert_eq!(
        path_a,
        persisted_state::state_path(data.path(), root_a.path())
    );
    assert_ne!(
        path_a,
        persisted_state::state_path(data.path(), root_b.path())
    );
    assert!(
        !path_a.starts_with(root_a.path()),
        "state never lives in the repository"
    );

    assert_eq!(persisted_state::load(&path_a).unwrap(), None);
    let document = serde_json::json!({"version": 1, "notes": [{"id": "n1", "text": "hello"}]});
    persisted_state::save(&path_a, &document).unwrap();
    assert_eq!(persisted_state::load(&path_a).unwrap(), Some(document));
    assert!(
        !path_a.with_extension("json.tmp").exists(),
        "no temporary file is left behind"
    );

    let huge = serde_json::json!({"blob": "x".repeat(5 * 1024 * 1024)});
    assert_eq!(
        persisted_state::save(&path_a, &huge).unwrap_err().code,
        "limit_exceeded"
    );
    std::fs::write(&path_a, b"{not json").unwrap();
    assert_eq!(
        persisted_state::load(&path_a).unwrap_err().code,
        "corrupt_state"
    );
}

#[tokio::test]
async fn nodes_exist_separates_vanished_nodes_from_nodes_that_are_merely_offscreen() {
    let (_dir, entry) = ready().await;
    let found = entry
        .nodes_exist(NodesExistRequest {
            groups: vec![
                "import_cycle:src/a.rs".into(),
                "declared_package:gone".into(),
            ],
            files: vec![
                "src/a.rs".into(),
                "src/deleted.rs".into(),
                "../escape".into(),
            ],
        })
        .unwrap();
    assert_eq!(found.groups, vec!["import_cycle:src/a.rs"]);
    assert_eq!(found.files, vec!["src/a.rs"]);
}
