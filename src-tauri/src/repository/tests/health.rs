//! Code health through the host: the fixture repository plus one tangled file.
use super::{commit_history, write, write_fixture, Entry};

const TANGLED: &str = r#"pub fn route(a: u32, b: u32, c: bool, d: bool) -> u32 {
    if c && (d || !c) && a > b {
        for i in 0..a {
            if i % 2 == 0 {
                while b > i {
                    if d {
                        return 1;
                    }
                }
            }
        }
    }
    match a {
        1 => 1,
        2 => 2,
        3 => 3,
        _ => 0,
    }
}
"#;

async fn entry() -> (tempfile::TempDir, Entry) {
    let dir = tempfile::tempdir().unwrap();
    write_fixture(dir.path());
    write(
        dir.path(),
        "src/lib.rs",
        "pub mod a;\npub mod b;\npub mod c;\npub mod tangled;\n",
    );
    write(dir.path(), "src/tangled.rs", TANGLED);
    commit_history(dir.path());
    let entry = Entry::new(dir.path()).unwrap();
    entry.refresh(true).await.unwrap();
    (dir, entry)
}

#[tokio::test]
async fn the_report_ranks_files_worst_first_with_detectors_and_roll_ups() {
    let (_dir, entry) = entry().await;
    let report = entry.code_health().unwrap();
    assert_eq!(
        report.files[0].path,
        "src/tangled.rs",
        "{:?}",
        report
            .files
            .iter()
            .map(|f| (&f.path, f.defect))
            .collect::<Vec<_>>()
    );
    let tangled = &report.files[0];
    // Nesting high, a low condition, a medium complex method: 10 − 2.854.
    assert_eq!(tangled.defect, Some(7.15));
    assert!(tangled
        .top_issue
        .as_deref()
        .unwrap()
        .contains("nests control blocks 5 deep"));
    let ids: Vec<&str> = report.detectors.iter().map(|d| d.id.as_str()).collect();
    assert!(
        ids.contains(&"nested_complexity") && ids.contains(&"complex_method"),
        "{ids:?}"
    );
    assert!(report.repository.average.is_some());
    assert_eq!(
        report.repository.worst_file.as_ref().unwrap().path,
        "src/tangled.rs"
    );
    assert!(report.history);
    assert_eq!(report.languages_measured, ["rust", "typescript"]);
    assert!(report.folders.iter().any(|f| f.path == "src"));
    assert!(report.self_check.is_none(), "too few files to say anything");
    // The same snapshots give the same report without measuring again.
    let again = entry.code_health().unwrap();
    assert_eq!(
        serde_json::to_value(&again).unwrap(),
        serde_json::to_value(&report).unwrap()
    );
}

#[tokio::test]
async fn the_drawer_and_the_fix_prompt() {
    let (_dir, entry) = entry().await;
    let detail = entry.code_health_file("src/tangled.rs").unwrap();
    assert_eq!(
        detail.findings[0].finding.detector, "nested_complexity",
        "most costly first"
    );
    assert!((detail.findings[0].impact - 1.608).abs() < 1e-9);
    assert_eq!(detail.functions[0].name, "route");
    assert_eq!(detail.functions[0].ccn, 12);
    assert_eq!(detail.target, 8.0);
    assert_eq!(
        entry.code_health_file("nope.rs").unwrap_err().code,
        "not_found"
    );

    let prompt = entry.code_health_prompt("src/tangled.rs", None).unwrap();
    for part in [
        "## Target",
        "## Current state",
        "Code health 7.2 of 10",
        "## Issues",
        "nested complexity in `route`",
        "blast_radius",
        "## Constraints",
        "## Expected output",
        "snapshot ",
    ] {
        assert!(prompt.contains(part), "missing {part}:\n{prompt}");
    }
    assert!(!prompt.contains("return 1;"), "no file contents");
    // Every issue is spelled out: listed up front, then where, what was measured, and how to fix it.
    assert!(prompt.contains(&format!("Fix all {} issues:", detail.findings.len())));
    for f in &detail.findings {
        assert!(
            prompt.contains(&f.finding.reason),
            "missing {}:\n{prompt}",
            f.finding.reason
        );
    }
    for part in [
        "- Location: `src/tangled.rs` lines",
        "- Measured: ",
        "- What this check looks for: ",
        "- How to fix: Flatten the nesting",
        "- Done when: ",
    ] {
        assert!(prompt.contains(part), "missing {part}:\n{prompt}");
    }
    // The Files drawer's prompt for the whole file carries the same issues.
    let files = entry.dashboard_prompt("src/tangled.rs", None).unwrap();
    assert!(files.contains("## Code health issues"), "{files}");
    assert!(files.contains(&detail.findings[0].finding.reason));
    assert!(files.contains("- How to fix: "));
    let id = detail.findings[1].finding.id.clone();
    let one = entry
        .code_health_prompt("src/tangled.rs", Some(&id))
        .unwrap();
    assert!(one.contains("Confirm the issue"));
    assert_eq!(
        entry
            .code_health_prompt("src/tangled.rs", Some("x"))
            .unwrap_err()
            .code,
        "not_found"
    );
}
