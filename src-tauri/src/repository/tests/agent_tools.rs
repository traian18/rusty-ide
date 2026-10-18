//! The agent loop's repository tools through the host, on the code health fixture: one tangled
//! function in `src/tangled.rs` among a small Rust and TypeScript repository with history.
use std::sync::Arc;

use serde_json::{json, Value};

use super::{health::entry as health_entry, write};
use crate::repository::agent_tools::{run, source};

async fn call(entry: &Arc<super::Entry>, tool: &str, arguments: Value) -> Value {
    run(entry.clone(), tool, arguments).await.unwrap()["result"].clone()
}

async fn fixture() -> (tempfile::TempDir, Arc<super::Entry>) {
    let (dir, entry) = health_entry().await;
    (dir, Arc::new(entry))
}

#[tokio::test]
async fn repo_symbol_serves_one_body_from_disk_and_names_candidates_otherwise() {
    let (_dir, entry) = fixture().await;
    let answer = call(
        &entry,
        "repo_symbol",
        json!({"target": "src/tangled.rs::route"}),
    )
    .await;
    assert_eq!(answer["status"], "ok", "{answer}");
    let source = answer["sections"]["source"].as_str().unwrap();
    assert!(source.starts_with("    1| pub fn route("), "{source}");
    assert!(source.contains("   19| }"), "{source}");
    assert_eq!(
        answer["complete"]["served"][0],
        "src/tangled.rs::route lines 1-19"
    );

    let range = call(
        &entry,
        "repo_symbol",
        json!({"target": "src/tangled.rs:2-3"}),
    )
    .await;
    assert_eq!(
        range["sections"]["source"]
            .as_str()
            .unwrap()
            .lines()
            .count(),
        2
    );

    let missing = call(
        &entry,
        "repo_symbol",
        json!({"target": "src/tangled.rs::nope"}),
    )
    .await;
    assert_eq!(missing["status"], "not_found");
    assert_eq!(missing["sections"]["candidates"][0]["name"], "route");

    // An argument the tool does not know is reported, not applied.
    let odd = call(
        &entry,
        "repo_symbol",
        json!({"target": "src/tangled.rs::route", "colour": "red"}),
    )
    .await;
    assert_eq!(odd["ignored"][0]["argument"], "colour");
}

#[tokio::test]
async fn repo_health_ranks_what_to_fix_measures_edits_live_and_explains_one_finding() {
    let (dir, entry) = fixture().await;
    let dashboard = call(&entry, "repo_health", json!({})).await;
    assert_eq!(dashboard["status"], "ok", "{dashboard}");
    let first = &dashboard["sections"]["fix_first"][0];
    assert_eq!(first["path"], "src/tangled.rs", "{dashboard}");
    assert_eq!(dashboard["next"][0]["arguments"]["finding"], first["id"]);

    let fix = call(&entry, "repo_health", json!({"finding": first["id"]})).await;
    let instructions = fix["sections"]["instructions"].as_str().unwrap();
    assert!(instructions.contains("- How to fix: "), "{instructions}");
    assert_eq!(
        fix["next"][0]["arguments"]["target"],
        "src/tangled.rs::route"
    );

    // Simplify the file on disk: the live score rises above the indexed one, no re-index needed.
    write(
        dir.path(),
        "src/tangled.rs",
        "pub fn route(a: u32) -> u32 {\n    a + 1\n}\n",
    );
    let after = call(
        &entry,
        "repo_health",
        json!({"targets": ["src/tangled.rs", "src/missing.rs"]}),
    )
    .await;
    let file = &after["sections"]["files"][0];
    assert!(
        file["score_now"].as_f64().unwrap() > file["score_indexed"].as_f64().unwrap(),
        "{after}"
    );
    assert!(file["change"].as_f64().unwrap() > 0.0);
    assert!(!file["resolved_since_index"].as_array().unwrap().is_empty());
    assert!(
        after["summary"].as_str().unwrap().contains("1 better"),
        "{after}"
    );
    assert_eq!(after["sections"]["files"][1]["status"], "not_found");
}

#[tokio::test]
async fn repo_risk_reports_dependents_and_a_directive_for_a_change() {
    let (_dir, entry) = fixture().await;
    let answer = call(&entry, "repo_risk", json!({"targets": ["src/a.rs"]})).await;
    assert_eq!(answer["status"], "ok", "{answer}");
    let card = &answer["sections"]["files"][0];
    assert_eq!(card["resolved"], true, "{answer}");
    assert!(card["dependents"].is_number() && card["commits"].is_number());
    assert!(answer["directive"].is_null() && answer["sections"]["directive"].is_null());

    let change = call(
        &entry,
        "repo_risk",
        json!({"changed_files": ["src/a.rs", "src/tangled.rs"]}),
    )
    .await;
    let directive = &change["sections"]["directive"];
    assert!(directive["reach"].is_string(), "{change}");
    assert!(directive["tests_to_run"].is_array() && directive["may_break"].is_array());
    assert!(change["summary"]
        .as_str()
        .unwrap()
        .starts_with("change of 2 file(s)"));

    let unknown = call(&entry, "repo_risk", json!({"targets": ["src/nope.rs"]})).await;
    assert_eq!(unknown["sections"]["files"][0]["resolved"], false);
}

#[tokio::test]
async fn repo_overview_brings_structure_health_and_history_together() {
    let (_dir, entry) = fixture().await;
    let answer = call(
        &entry,
        "repo_overview",
        json!({"include": ["outline", "nonsense"]}),
    )
    .await;
    assert_eq!(answer["status"], "ok", "{answer}");
    let sections = &answer["sections"];
    assert!(
        sections["structure"]["packages"]
            .as_array()
            .is_some_and(|p| !p.is_empty()),
        "{answer}"
    );
    assert!(sections["code_health"]["score"].is_number());
    assert!(sections["history"]["active_contributors_recent"].is_number());
    assert!(sections["map"].is_object(), "{answer}");
    assert!(answer["summary"]
        .as_str()
        .unwrap()
        .contains("no written documentation yet"));
    assert_eq!(answer["ignored"][0]["value"], "nonsense");
    // No documentation store in tests: the outline says nothing is written.
    assert_eq!(sections["outline"][0]["written"], false);
}

#[tokio::test]
async fn repo_context_answers_several_targets_with_symbols_skeleton_and_health() {
    let (_dir, entry) = fixture().await;
    let one = call(
        &entry,
        "repo_context",
        json!({"target": "src/tangled.rs", "include": ["skeleton", "health", "owners", "history"]}),
    )
    .await;
    let sections = &one["sections"];
    assert_eq!(sections["symbols"]["items"][0]["name"], "route", "{one}");
    let skeleton = sections["skeleton"]["text"].as_str().unwrap();
    assert!(
        skeleton.contains("    1| pub fn route(") && skeleton.contains("… lines 2-18"),
        "{skeleton}"
    );
    assert!(sections["health"]["score_now"].is_number(), "{one}");
    assert!(sections["owners"]["contributors"].is_number(), "{one}");

    let many = call(
        &entry,
        "repo_context",
        json!({"targets": ["src/a.rs", "src/tangled.rs"], "include": ["bogus"]}),
    )
    .await;
    assert_eq!(many["status"], "ok", "{many}");
    assert!(
        many["sections"]["src/a.rs"]["summary"].is_string(),
        "{many}"
    );
    assert!(
        many["sections"]["src/tangled.rs"]["sections"]["symbols"].is_object(),
        "{many}"
    );
    assert_eq!(many["ignored"][0]["value"], "bogus");
}

#[tokio::test]
async fn the_skeleton_keeps_signatures_and_elides_bodies() {
    let (dir, entry) = fixture().await;
    write(dir.path(), "src/shape.ts", "import { x } from './x';\n\nexport class Shape {\n  area(): number {\n    const a = 1;\n    const b = 2;\n    return a * b;\n  }\n}\n\nexport function make(): Shape {\n  const s = new Shape();\n  return s;\n}\n");
    let file = source::read(&entry, "src/shape.ts").unwrap();
    let (text, cut) = file.skeleton(100);
    assert!(!cut);
    assert!(text.contains("    1| import { x } from './x';"), "{text}");
    assert!(
        text.contains("    4|   area(): number {") && text.contains("… lines 5-7"),
        "{text}"
    );
    assert!(
        text.contains("   11| export function make(): Shape {") && text.contains("… lines 12-13"),
        "{text}"
    );
    assert_eq!(file.find("Shape.area").len(), 1);
    assert_eq!(file.find("Shape")[0].1, "class");
}
