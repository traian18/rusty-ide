//! The dashboard pages read the indexes the entry already has: overview, map, table and drawer.
use super::{ready, write};
use crate::repository::dashboard::model::FilesQuery;

#[tokio::test]
async fn the_map_aggregates_a_level_and_drills_into_a_folder() {
    let (_dir, entry) = ready().await;
    let top = entry.dashboard_map("").unwrap();
    let names: Vec<&str> = top.tiles.iter().map(|t| t.name.as_str()).collect();
    assert!(
        names.contains(&"src") && names.contains(&"web"),
        "{names:?}"
    );
    let src = top.tiles.iter().find(|t| t.name == "src").unwrap();
    assert!(src.folder);
    assert_eq!(src.files, 4);
    assert_eq!(src.languages[0].0, "rust");
    assert!(src.commits >= 8);
    assert!(src.findings.medium + src.findings.high > 0);
    assert_eq!(top.total.files, 6);
    assert_eq!(top.language_ranks[0], "rust");

    let inside = entry.dashboard_map("src/").unwrap();
    assert_eq!(inside.path, "src");
    let a = inside.tiles.iter().find(|t| t.name == "a.rs").unwrap();
    assert!(!a.folder);
    assert!(a.dependents > 0, "a.rs is imported by b.rs and c.rs");
    assert_eq!(
        entry.dashboard_map("nowhere").unwrap_err().code,
        "not_found"
    );
}

#[tokio::test]
async fn the_table_filters_sorts_and_pages() {
    let (_dir, entry) = ready().await;
    let all = entry.dashboard_files(&FilesQuery::default()).unwrap();
    assert_eq!(all.total, 6);
    let by_commits = entry
        .dashboard_files(&FilesQuery {
            sort: Some("commits".into()),
            limit: Some(2),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(by_commits.rows.len(), 2);
    assert!(by_commits.rows.iter().all(|r| r.commits == 4));
    let typescript = entry
        .dashboard_files(&FilesQuery {
            language: Some("typescript".into()),
            sort: Some("path".into()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(
        typescript
            .rows
            .iter()
            .map(|r| r.path.as_str())
            .collect::<Vec<_>>(),
        ["web/src/dead.ts", "web/src/index.ts"]
    );
    let flagged = entry
        .dashboard_files(&FilesQuery {
            has_findings: Some(true),
            path: Some("src".into()),
            ..Default::default()
        })
        .unwrap();
    assert!(flagged.rows.iter().all(|r| r.path.starts_with("src/")));
    assert!(flagged.rows.iter().any(|r| r.path == "src/a.rs"));
    let text = entry
        .dashboard_files(&FilesQuery {
            text: Some("DEAD".into()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(text.total, 1);
    assert_eq!(
        entry
            .dashboard_files(&FilesQuery {
                sort: Some("bogus".into()),
                ..Default::default()
            })
            .unwrap_err()
            .code,
        "invalid_request"
    );
}

#[tokio::test]
async fn the_drawer_has_neighbours_findings_history_and_its_page() {
    let (dir, entry) = ready().await;
    let a = entry.dashboard_file("src/a.rs").unwrap();
    assert_eq!(a.row.lines, 6);
    assert_eq!(a.row.language, "rust");
    assert!(a.importers.iter().any(|n| n.path == "src/c.rs"));
    assert_eq!(
        a.imports
            .iter()
            .map(|n| n.path.as_str())
            .collect::<Vec<_>>(),
        ["src/b.rs"]
    );
    assert!(a.blast_radius >= 2);
    let cycle = a
        .findings
        .iter()
        .find(|f| f.rule == "import-cycle")
        .unwrap();
    assert_eq!(cycle.lines, [1]);
    assert_eq!(cycle.other_files, ["src/b.rs"]);
    assert_eq!(a.authors[0].name, "Alice");
    assert!(a.co_changed.iter().any(|c| c.path == "src/b.rs"));
    assert_eq!(a.page, "file:src/a.rs");
    assert_eq!(
        entry.dashboard_file("src/missing.rs").unwrap_err().code,
        "not_found"
    );

    // The fix prompt carries the facts, the issue, the blast-radius step and the snapshot.
    let prompt = entry.dashboard_prompt("src/a.rs", Some(&cycle.id)).unwrap();
    for part in [
        "## Target",
        "## Current state",
        "## Issues",
        "## Tasks",
        "## Constraints",
        "## Expected output",
        "line 1",
        "`src/b.rs`",
        "blast_radius",
        "snapshot ",
    ] {
        assert!(prompt.contains(part), "missing {part}:\n{prompt}");
    }
    assert!(!prompt.contains("pub struct"), "no file contents");
    let whole = entry.dashboard_prompt("src/a.rs", None).unwrap();
    assert!(whole.contains("## Issues"));
    assert_eq!(
        entry
            .dashboard_prompt("src/a.rs", Some("nope"))
            .unwrap_err()
            .code,
        "not_found"
    );

    // Line counts are cached by content: a changed file is counted again after a refresh.
    write(dir.path(), "src/c.rs", "use crate::a::A;\n\n\n");
    entry.refresh(true).await.unwrap();
    assert_eq!(entry.dashboard_file("src/c.rs").unwrap().row.lines, 3);
}
