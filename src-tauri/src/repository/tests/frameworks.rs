//! Framework relations through the host service.
use std::path::Path;

use crate::repository::{dto::FrameworkRequest, entry::Entry};

fn write(root: &Path, relative: &str, text: &str) {
    let full = root.join(relative);
    std::fs::create_dir_all(full.parent().unwrap()).unwrap();
    std::fs::write(full, text).unwrap();
}

fn fixture(root: &Path) {
    write(
        root,
        "package.json",
        r#"{"name":"api","dependencies":{"express":"4","react":"18"}}"#,
    );
    write(root, "src/app.ts", "import express from 'express';\nimport { list } from './users';\nconst app = express();\napp.get('/users', list);\nexport default app;\n");
    write(root, "src/users.ts", "export function list() {}\n");
    write(
        root,
        "src/Page.tsx",
        "import { Card } from './Card';\nexport function Page() { return <Card />; }\n",
    );
    write(
        root,
        "src/Card.tsx",
        "export function Card() { return <i />; }\n",
    );
}

#[tokio::test]
async fn frameworks_are_summarised_and_relations_are_paged() {
    let dir = tempfile::tempdir().unwrap();
    fixture(dir.path());
    let entry = Entry::new(dir.path()).unwrap();
    assert_eq!(
        entry
            .framework_relations(FrameworkRequest::default())
            .err()
            .unwrap()
            .code,
        "snapshot_not_found"
    );
    let refreshed = entry.refresh(false).await.unwrap();
    let frameworks = &refreshed.snapshot.frameworks;
    assert!(frameworks.configured);
    let names: Vec<_> = frameworks
        .applications
        .iter()
        .map(|a| a.framework.as_str())
        .collect();
    assert_eq!(names, ["express", "react"]);
    assert_eq!(frameworks.relations, 2);

    let all = entry
        .framework_relations(FrameworkRequest::default())
        .unwrap();
    assert_eq!(all.relations.len(), 2);
    let routes = entry
        .framework_relations(FrameworkRequest {
            framework: Some("express".into()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(routes.relations[0].label, "GET /users");
    let first_page = entry
        .framework_relations(FrameworkRequest {
            limit: Some(1),
            ..Default::default()
        })
        .unwrap();
    assert!(first_page.next_cursor.is_some());
    let by_file = entry
        .framework_relations(FrameworkRequest {
            file: Some("src/Card.tsx".into()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(
        by_file.relations.len(),
        1,
        "relations that end in the file match"
    );
    assert_eq!(
        entry
            .framework_relations(FrameworkRequest {
                limit: Some(0),
                ..Default::default()
            })
            .err()
            .unwrap()
            .code,
        "limit_exceeded"
    );
    assert_eq!(
        entry
            .framework_relations(FrameworkRequest {
                file: Some("/etc/passwd".into()),
                ..Default::default()
            })
            .err()
            .unwrap()
            .code,
        "invalid_request"
    );
}

#[tokio::test]
async fn the_file_graph_carries_framework_edges_separately_from_imports() {
    let dir = tempfile::tempdir().unwrap();
    fixture(dir.path());
    let entry = Entry::new(dir.path()).unwrap();
    entry.refresh(false).await.unwrap();
    let graph = entry
        .group_graph(crate::repository::dto::GroupGraphRequest {
            group: "dir:src".into(),
            node_limit: None,
            edge_limit: None,
        })
        .unwrap();
    let mut edges: Vec<_> = graph
        .framework_edges
        .iter()
        .map(|e| format!("{}->{}:{}", e.from, e.to, e.label))
        .collect();
    edges.sort();
    assert_eq!(
        edges,
        [
            "src/Page.tsx->src/Card.tsx:<Card />",
            "src/app.ts->src/users.ts:GET /users"
        ]
    );
    // The same two files are also linked by ordinary imports, which stay in `edges`.
    assert!(graph
        .edges
        .iter()
        .any(|e| e.from == "src/app.ts" && e.to == "src/users.ts"));
}
