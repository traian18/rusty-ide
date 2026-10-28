//! A goal's measurement through the registry, on the code health fixture: files, folders and globs
//! in scope, structure-only health, guideline errors, and a fingerprint that follows the files.
use super::{health::entry as health_entry, write};
use crate::repository::{goal_measure::measure, RepositoryState};

#[tokio::test]
async fn a_scope_is_measured_live_with_its_guideline_errors_and_a_fingerprint() {
    let (dir, _entry) = health_entry().await;
    let root = dir.path().to_string_lossy().into_owned();
    let state = RepositoryState::new();

    let one = measure(&state, &root, None, &["src/tangled.rs".into()], &[])
        .await
        .unwrap();
    assert_eq!(one.files.len(), 1);
    let tangled = &one.files[0];
    assert_eq!(tangled.path, "src/tangled.rs");
    assert!(tangled.score.unwrap() < 8.5, "{tangled:?}");
    assert!(
        tangled
            .findings
            .iter()
            .any(|f| f.issue == "nested complexity"),
        "{:?}",
        tangled.findings
    );
    // History is not something a pass can fix, so it is not measured.
    assert!(tangled.findings.iter().all(|f| !matches!(
        f.issue.as_str(),
        "churn risk" | "prior defect" | "ownership risk"
    )));
    assert!(one.guideline_errors.is_empty());

    let folder = measure(&state, &root, None, &["src".into()], &[])
        .await
        .unwrap();
    assert!(folder.files.len() > 1, "{:?}", folder.files);
    let glob = measure(&state, &root, None, &["src/*.rs".into()], &[])
        .await
        .unwrap();
    assert_eq!(
        glob.files.len(),
        folder
            .files
            .iter()
            .filter(|f| f.path.ends_with(".rs"))
            .count()
    );

    // An empty scope measures the files the passes touched.
    let touched = measure(&state, &root, None, &[], &["src/tangled.rs".into()])
        .await
        .unwrap();
    assert_eq!(touched.fingerprint, one.fingerprint);

    write(
        dir.path(),
        ".rusty/guidelines/rules.json",
        r#"{"version": 1, "rules": [{"id": "no-unwrap", "kind": "pattern", "regex": "\\.unwrap\\(\\)"}]}"#,
    );
    let tangled_text = std::fs::read_to_string(dir.path().join("src/tangled.rs")).unwrap();
    write(
        dir.path(),
        "src/tangled.rs",
        &format!("{tangled_text}\npub fn extra() -> u8 {{\n    \"1\".parse().unwrap()\n}}\n"),
    );
    let edited = measure(&state, &root, None, &["src/tangled.rs".into()], &[])
        .await
        .unwrap();
    assert_eq!(
        edited.guideline_errors.len(),
        1,
        "{:?}",
        edited.guideline_errors
    );
    assert_eq!(edited.guideline_errors[0].rule, "no-unwrap");
    assert_ne!(edited.fingerprint, one.fingerprint);
}
