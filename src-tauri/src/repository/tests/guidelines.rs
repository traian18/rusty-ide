//! `code_guidelines` through the host on the code health fixture, whose `src/tangled.rs` is
//! committed: rules read from `.rusty/guidelines`, files checked live, only what an uncommitted
//! change introduced counted, and code health measured with the project's thresholds.
use std::sync::Arc;

use serde_json::{json, Value};

use super::{health::entry as health_entry, write};
use crate::repository::agent_tools::run;

async fn call(entry: &Arc<super::Entry>, arguments: Value) -> Value {
    run(entry.clone(), "code_guidelines", arguments)
        .await
        .unwrap()["result"]
        .clone()
}

const RULES: &str = r#"{
  "version": 1,
  "limits": { "max_complexity": 5 },
  "rules": [
    { "id": "no-unwrap", "kind": "pattern", "regex": "\\.unwrap\\(\\)", "fix": "return the error" },
    { "id": "naming", "kind": "prose", "text": "Name functions after what they do." }
  ]
}"#;

#[tokio::test]
async fn rules_are_read_and_only_what_a_change_introduced_counts() {
    let (dir, entry) = health_entry().await;
    let entry = Arc::new(entry);
    let none = call(&entry, json!({"targets": ["src/tangled.rs"]})).await;
    assert_eq!(none["status"], "not_configured", "{none}");

    write(dir.path(), ".rusty/guidelines/rules.json", RULES);
    write(
        dir.path(),
        ".rusty/guidelines/style.md",
        "Keep modules small.\n",
    );
    let rules = call(
        &entry,
        json!({"mode": "rules", "targets": ["src/tangled.rs"]}),
    )
    .await;
    let file = &rules["sections"]["files"][0];
    assert_eq!(file["rules"][0]["id"], "no-unwrap", "{rules}");
    assert_eq!(file["limits"]["max_complexity"], 5);
    assert_eq!(file["style"][0], "Keep modules small.");

    // Everything in the file: the tangled function is over the complexity limit.
    let all = call(
        &entry,
        json!({"mode": "check", "targets": ["src/tangled.rs"]}),
    )
    .await;
    assert_eq!(all["status"], "violations", "{all}");
    assert_eq!(
        all["sections"]["files"][0]["violations"][0]["rule"],
        "limits"
    );
    // The committed file is unchanged, so the change introduced nothing.
    let unchanged = call(
        &entry,
        json!({"mode": "check", "targets": ["src/tangled.rs"], "changed_only": true}),
    )
    .await;
    assert_eq!(unchanged["status"], "ok", "{unchanged}");
    assert_eq!(unchanged["sections"]["errors"], 0);

    let tangled = std::fs::read_to_string(dir.path().join("src/tangled.rs")).unwrap();
    write(
        dir.path(),
        "src/tangled.rs",
        &format!("{tangled}\npub fn extra() -> u8 {{\n    \"1\".parse().unwrap()\n}}\n"),
    );
    let edited = call(
        &entry,
        json!({"mode": "check", "targets": ["src/tangled.rs"], "changed_only": true}),
    )
    .await;
    let found = edited["sections"]["files"][0]["violations"]
        .as_array()
        .unwrap();
    assert_eq!(found.len(), 1, "{edited}");
    assert_eq!(found[0]["rule"], "no-unwrap");
    assert_eq!(found[0]["fix"], "return the error");
    assert_eq!(edited["sections"]["errors"], 1);

    write(
        dir.path(),
        ".rusty/guidelines/rules.json",
        r#"{"version": 1, "rules": [{"id": "x", "kind": "pattern"}]}"#,
    );
    let invalid = call(&entry, json!({"targets": ["src/tangled.rs"]})).await;
    assert_eq!(invalid["status"], "invalid", "{invalid}");
}

#[tokio::test]
async fn code_health_measures_with_the_projects_thresholds() {
    let (dir, entry) = health_entry().await;
    let before = entry.code_health().unwrap();
    let tangled = before
        .files
        .iter()
        .find(|f| f.path == "src/tangled.rs")
        .unwrap();
    assert!(tangled
        .top_issue
        .as_deref()
        .unwrap()
        .contains("nests control blocks"));

    write(
        dir.path(),
        ".rusty/guidelines/rules.json",
        r#"{"version": 1, "detectors": {"disabled": ["nested_complexity"]}}"#,
    );
    let after = entry.code_health().unwrap();
    let tangled = after
        .files
        .iter()
        .find(|f| f.path == "src/tangled.rs")
        .unwrap();
    assert!(
        !tangled
            .top_issue
            .as_deref()
            .unwrap_or("")
            .contains("nests control blocks"),
        "{:?}",
        tangled.top_issue
    );
    assert!(
        tangled.defect
            > before
                .files
                .iter()
                .find(|f| f.path == "src/tangled.rs")
                .unwrap()
                .defect
    );
}
