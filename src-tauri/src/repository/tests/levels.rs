//! The levelled architecture view, against fixture repositories.
use std::path::Path;

use crate::repository::{
    dto::{LevelName, LevelRequest, LevelView},
    entry::Entry,
};

fn write(root: &Path, relative: &str, text: &str) {
    let full = root.join(relative);
    std::fs::create_dir_all(full.parent().unwrap()).unwrap();
    std::fs::write(full, text).unwrap();
}

/// `engine` has a cycle (a <-> b) inside `src/tools`, a small directory and a root file;
/// `app` depends on it; `web` is a TypeScript package.
fn write_workspace(root: &Path) {
    write(
        root,
        "engine/Cargo.toml",
        "[package]\nname = \"engine\"\nversion = \"0.1.0\"\n",
    );
    write(
        root,
        "engine/src/lib.rs",
        "pub mod tools;\npub mod small;\n",
    );
    write(
        root,
        "engine/src/tools/mod.rs",
        "pub mod a;\npub mod b;\npub mod c;\n",
    );
    write(
        root,
        "engine/src/tools/a.rs",
        "use super::b::B;\npub struct A;\n",
    );
    write(
        root,
        "engine/src/tools/b.rs",
        "use super::a::A;\npub struct B;\n",
    );
    write(root, "engine/src/tools/c.rs", "use super::a::A;\n");
    write(root, "engine/src/small/mod.rs", "pub struct D;\n");
    write(root, "app/Cargo.toml", "[package]\nname = \"app\"\nversion = \"0.1.0\"\n[dependencies]\nengine = { path = \"../engine\" }\n");
    write(
        root,
        "app/src/main.rs",
        "use engine::tools::a::A;\nfn main() {}\n",
    );
    write(
        root,
        "web/package.json",
        r#"{"name":"web","types":"src/index.ts"}"#,
    );
    write(root, "web/src/index.ts", "export const i = 1;\n");
}

async fn ready() -> (tempfile::TempDir, Entry) {
    let dir = tempfile::tempdir().unwrap();
    write_workspace(dir.path());
    let entry = Entry::new(dir.path()).unwrap();
    entry.refresh(false).await.unwrap();
    (dir, entry)
}

fn request(level: LevelName, focus: Option<&str>) -> LevelRequest {
    LevelRequest {
        level,
        focus: focus.map(str::to_owned),
        import_kind: None,
        node_limit: None,
        edge_limit: None,
    }
}

fn node<'a>(view: &'a LevelView, label: &str) -> &'a crate::repository::dto::LevelNode {
    view.nodes
        .iter()
        .find(|node| node.label == label)
        .unwrap_or_else(|| {
            panic!(
                "no node {label}: {:?}",
                view.nodes.iter().map(|n| &n.label).collect::<Vec<_>>()
            )
        })
}

#[tokio::test]
async fn packages_level_aggregates_files_languages_edges_and_cycles() {
    let (_dir, entry) = ready().await;
    let view = entry
        .architecture_level(request(LevelName::Packages, None))
        .unwrap();
    let labels = view
        .nodes
        .iter()
        .map(|n| n.label.as_str())
        .collect::<Vec<_>>();
    assert_eq!(labels, ["app", "engine", "web"], "{labels:?}");
    assert_eq!(node(&view, "engine").file_count, 6);
    assert_eq!(node(&view, "engine").languages["rust"], 6);
    assert_eq!(node(&view, "web").languages["typescript"], 1);
    assert!(
        node(&view, "engine").in_cycle
            && !node(&view, "web").in_cycle
            && !node(&view, "app").in_cycle
    );
    let edge = view
        .edges
        .iter()
        .find(|e| node(&view, "app").id == e.from && node(&view, "engine").id == e.to);
    assert_eq!(
        edge.map(|e| (e.runtime, e.type_only, e.in_cycle)),
        Some((1, 0, false)),
        "{:?}",
        view.edges
    );
    assert!(view.nodes.iter().all(|n| n.parent.is_none()) && view.cycle_groups == 1);
    assert!(!view.nodes_truncated && !view.edges_truncated);
}

#[tokio::test]
async fn components_level_shows_direct_components_and_collapses_the_rest() {
    let (_dir, entry) = ready().await;
    let packages = entry
        .architecture_level(request(LevelName::Packages, None))
        .unwrap();
    let engine = node(&packages, "engine").id.clone();
    let view = entry
        .architecture_level(request(LevelName::Components, Some(&engine)))
        .unwrap();
    let tools = node(&view, "tools");
    assert_eq!(
        (tools.id.as_str(), tools.file_count),
        ("dir:engine/src/tools", 4)
    );
    assert!(tools.children.is_empty(), "a leaf has nothing to preview");
    // Files outside every component are one synthetic node; other packages another.
    assert!(view
        .nodes
        .iter()
        .any(|n| n.synthetic && n.id.starts_with("rest:")));
    assert!(view.nodes.iter().all(|n| n.parent.is_none()));
}

#[tokio::test]
async fn nested_directories_are_previewed_as_children_and_can_be_drilled_into() {
    let (dir, entry) = ready().await;
    for name in ["x", "y", "z"] {
        write(
            dir.path(),
            &format!("engine/src/tools/deep/{name}.rs"),
            "pub struct S;\n",
        );
    }
    write(
        dir.path(),
        "engine/src/tools/mod.rs",
        "pub mod a;\npub mod b;\npub mod c;\npub mod deep;\n",
    );
    write(
        dir.path(),
        "engine/src/tools/deep/mod.rs",
        "pub mod x;\npub mod y;\npub mod z;\n",
    );
    entry.refresh(false).await.unwrap();
    let packages = entry
        .architecture_level(request(LevelName::Packages, None))
        .unwrap();
    let engine = node(&packages, "engine");
    // The package previews its components, and a component previews its own.
    let dots = engine
        .children
        .iter()
        .map(|c| c.id.as_str())
        .collect::<Vec<_>>();
    // Every folder is a circle, and the files in none of them are one more.
    assert_eq!(dots.len(), 3, "{dots:?}");
    assert_eq!(&dots[..2], ["dir:engine/src/tools", "dir:engine/src/small"]);
    assert!(dots[2].starts_with("rest:"));
    assert!(engine.children[0].has_children);
    let loose = dots[2].to_owned();
    let view = entry
        .architecture_level(request(LevelName::Components, Some(&engine.id.clone())))
        .unwrap();
    // A level shows only direct components; what lies deeper is previewed inside them.
    assert!(view
        .nodes
        .iter()
        .all(|n| n.id != "dir:engine/src/tools/deep"));
    let tools = node(&view, "tools");
    let inner = tools
        .children
        .iter()
        .map(|c| c.id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        inner,
        ["dir:engine/src/tools/deep", "rest:dir:engine/src/tools"]
    );
    assert!(!tools.children[0].has_children, "a leaf opens to its files");

    // A derived directory can be focused, drilled into and counted as existing like a group.
    let inner = entry
        .architecture_level(request(LevelName::Components, Some("dir:engine/src/tools")))
        .unwrap();
    assert!(inner
        .nodes
        .iter()
        .any(|n| n.id == "dir:engine/src/tools/deep"));
    let graph = entry
        .group_graph(crate::repository::dto::GroupGraphRequest {
            group: "dir:engine/src/tools/deep".into(),
            node_limit: None,
            edge_limit: None,
        })
        .unwrap();
    assert_eq!(graph.nodes.len(), 4);
    // The loose files of the package open as a group of their own: just `lib.rs`.
    let loose_graph = entry
        .group_graph(crate::repository::dto::GroupGraphRequest {
            group: loose,
            node_limit: None,
            edge_limit: None,
        })
        .unwrap();
    assert_eq!(loose_graph.nodes.len(), 1);
    let exists = entry
        .nodes_exist(crate::repository::dto::NodesExistRequest {
            groups: vec!["dir:engine/src/tools".into(), "dir:nowhere".into()],
            files: vec![],
        })
        .unwrap();
    assert_eq!(exists.groups, ["dir:engine/src/tools"]);
}

#[tokio::test]
async fn node_and_edge_limits_keep_the_largest_and_say_so() {
    let (_dir, entry) = ready().await;
    let mut limited = request(LevelName::Packages, None);
    limited.node_limit = Some(1);
    let view = entry.architecture_level(limited).unwrap();
    assert_eq!(view.nodes.len(), 1);
    assert_eq!(view.nodes[0].label, "engine", "the largest package is kept");
    assert!(view.nodes_truncated && view.total_nodes == 3);
}

#[tokio::test]
async fn import_kind_filter_removes_other_kinds() {
    let (_dir, entry) = ready().await;
    let mut only_types = request(LevelName::Packages, None);
    only_types.import_kind = Some(harness_workspace::import_graph::ImportKind::TypeOnly);
    let view = entry.architecture_level(only_types).unwrap();
    assert!(view.edges.is_empty(), "{:?}", view.edges);
}

#[tokio::test]
async fn invalid_requests_and_limits_have_typed_errors() {
    let (_dir, entry) = ready().await;
    let missing_focus = entry
        .architecture_level(request(LevelName::Components, None))
        .unwrap_err();
    assert_eq!(missing_focus.code, "invalid_request");
    let unknown = entry
        .architecture_level(request(LevelName::Components, Some("nope")))
        .unwrap_err();
    assert_eq!(unknown.code, "unknown_group");
    let mut zero = request(LevelName::Packages, None);
    zero.node_limit = Some(0);
    assert_eq!(
        entry.architecture_level(zero).unwrap_err().code,
        "limit_exceeded"
    );
}

#[tokio::test]
async fn a_repository_without_manifests_uses_top_level_directories() {
    let dir = tempfile::tempdir().unwrap();
    write(
        dir.path(),
        "client/a.ts",
        "import { b } from '../server/b';\nexport const a = 1;\n",
    );
    write(dir.path(), "server/b.ts", "export const b = 1;\n");
    write(dir.path(), "top.ts", "export const t = 1;\n");
    let entry = Entry::new(dir.path()).unwrap();
    entry.refresh(false).await.unwrap();
    let view = entry
        .architecture_level(request(LevelName::Packages, None))
        .unwrap();
    let ids = view.nodes.iter().map(|n| n.id.as_str()).collect::<Vec<_>>();
    assert!(
        ids.contains(&"dir:client") && ids.contains(&"dir:server"),
        "{ids:?}"
    );
    assert!(
        view.nodes.iter().any(|n| n.synthetic && n.file_count == 1),
        "root-level files form one node"
    );
    assert!(
        view.edges
            .iter()
            .any(|e| e.from == "dir:client" && e.to == "dir:server"),
        "{:?}",
        view.edges
    );
}

#[tokio::test]
async fn every_level_is_folders_plus_one_aggregate_of_loose_files() {
    let dir = tempfile::tempdir().unwrap();
    for file in [
        "app/ui/a/one.ts",
        "app/ui/b/two.ts",
        "app/ui/x.ts",
        "app/ui/y.ts",
        "app/solo/inner/deep.ts",
        "app/solo/inner/more.ts",
    ] {
        write(dir.path(), file, "export const v = 1;\n");
    }
    let entry = Entry::new(dir.path()).unwrap();
    entry.refresh(false).await.unwrap();
    let ids = |view: &LevelView| view.nodes.iter().map(|n| n.id.clone()).collect::<Vec<_>>();

    let top = entry
        .architecture_level(request(LevelName::Packages, None))
        .unwrap();
    assert_eq!(ids(&top), ["dir:app"]);
    // `app` holds two folders and no files of its own: two circles, no loose-files circle.
    let app = &top.nodes[0];
    assert_eq!(
        app.children
            .iter()
            .map(|c| c.label.as_str())
            .collect::<Vec<_>>(),
        ["ui", "solo"]
    );

    // Opening it shows exactly those folders, even though `solo` holds a single folder.
    let inside = entry
        .architecture_level(request(LevelName::Components, Some("dir:app")))
        .unwrap();
    assert_eq!(ids(&inside), ["dir:app/solo", "dir:app/ui"]);
    let ui = node(&inside, "ui");
    assert!(ui
        .children
        .iter()
        .any(|c| c.id == "dir:app/ui/a" && !c.has_children));
    assert!(ui
        .children
        .iter()
        .any(|c| c.id.starts_with("rest:") && c.file_count == 2));

    // `ui` shows its two folders and one aggregate for `x.ts` and `y.ts`.
    let ui_level = entry
        .architecture_level(request(LevelName::Components, Some("dir:app/ui")))
        .unwrap();
    let shown = ids(&ui_level);
    assert_eq!(shown.len(), 3, "{shown:?}");
    assert!(ui_level
        .nodes
        .iter()
        .any(|n| n.id.starts_with("rest:") && n.file_count == 2));

    // A folder with only files has no circles to show, so it opens to its files.
    let a = entry
        .architecture_level(request(LevelName::Components, Some("dir:app/ui/a")))
        .unwrap();
    assert!(a.nodes.iter().all(|n| n.synthetic), "{:?}", ids(&a));
    assert!(a.leaf && !ui_level.leaf && !inside.leaf && !top.leaf);
    // The loose-files circle lists its files, so findings can be summed for it.
    let loose = ui_level
        .nodes
        .iter()
        .find(|n| n.id.starts_with("rest:"))
        .unwrap();
    assert_eq!(loose.files, ["app/ui/x.ts", "app/ui/y.ts"]);
    assert!(node(&inside, "solo")
        .children
        .iter()
        .all(|c| !c.has_children));
}

/// Measures the levelled view on a real repository. Run with
/// `cargo test --lib measure_levels -- --ignored --nocapture`.
#[tokio::test]
#[ignore = "measures a real repository; run by hand"]
async fn measure_levels_on_the_rusty_core_checkout() {
    let root = std::env::var("MEASURE_ROOT").map_or_else(
        |_| Path::new(env!("CARGO_MANIFEST_DIR")).join("../../rusty-core"),
        std::path::PathBuf::from,
    );
    let entry = Entry::new(&root.canonicalize().unwrap()).unwrap();
    let started = std::time::Instant::now();
    entry.refresh(false).await.unwrap();
    println!("refresh: {:?}", started.elapsed());
    let started = std::time::Instant::now();
    let packages = entry
        .architecture_level(request(LevelName::Packages, None))
        .unwrap();
    println!(
        "packages: {:?} ({} nodes, {} edges)",
        started.elapsed(),
        packages.nodes.len(),
        packages.edges.len()
    );
    let biggest = packages.nodes.iter().max_by_key(|n| n.file_count).unwrap();
    let started = std::time::Instant::now();
    let components = entry
        .architecture_level(request(LevelName::Components, Some(&biggest.id)))
        .unwrap();
    println!(
        "components of {} ({} files): {:?} ({} nodes, {} edges)",
        biggest.label,
        biggest.file_count,
        started.elapsed(),
        components.nodes.len(),
        components.edges.len()
    );
    if let Ok(dir) = std::env::var("DUMP_LEVELS_TO") {
        std::fs::write(
            format!("{dir}/packages.json"),
            serde_json::to_string(&packages).unwrap(),
        )
        .unwrap();
        std::fs::write(
            format!("{dir}/components.json"),
            serde_json::to_string(&components).unwrap(),
        )
        .unwrap();
    }
}

#[tokio::test]
#[ignore = "walks every node of a real repository; run by hand"]
async fn walk_every_node_of_a_real_repository() {
    let root = std::env::var("MEASURE_ROOT").unwrap();
    let entry = Entry::new(&std::path::PathBuf::from(root)).unwrap();
    entry.refresh(false).await.unwrap();
    let mut pending = vec![(LevelName::Packages, None::<String>)];
    let mut seen = 0;
    while let Some((level, focus)) = pending.pop() {
        let view = entry
            .architecture_level(request(level, focus.as_deref()))
            .unwrap_or_else(|e| panic!("{level:?} {focus:?}: {e:?}"));
        seen += 1;
        for node in &view.nodes {
            if node.synthetic && !node.id.starts_with("rest:") {
                continue;
            }
            if node.children.is_empty() {
                let graph = entry.group_graph(crate::repository::dto::GroupGraphRequest {
                    group: node.id.clone(),
                    node_limit: None,
                    edge_limit: None,
                });
                assert!(graph.is_ok(), "files of {}: {:?}", node.id, graph.err());
            } else {
                pending.push((LevelName::Components, Some(node.id.clone())));
            }
            for child in &node.children {
                if child.has_children {
                    pending.push((LevelName::Components, Some(child.id.clone())));
                } else {
                    let graph = entry.group_graph(crate::repository::dto::GroupGraphRequest {
                        group: child.id.clone(),
                        node_limit: None,
                        edge_limit: None,
                    });
                    assert!(
                        graph.is_ok(),
                        "files of child {}: {:?}",
                        child.id,
                        graph.err()
                    );
                }
            }
        }
        if seen > 400 {
            break;
        }
    }
    println!("walked {seen} levels");
}
