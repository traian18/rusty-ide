//! Readable documentation: the plan, the brief, and a stored page that is checked on the way in.
use super::{ready, write};
use crate::repository::written::{
    documentation_settings, set_documentation_settings, store_path, DocumentationSettings,
    PageState,
};

#[tokio::test]
async fn a_page_is_planned_briefed_checked_stored_and_goes_stale() {
    let (dir, entry) = ready().await;
    let data = tempfile::tempdir().unwrap();
    let store = store_path(data.path(), entry.root());

    let plan = entry.documentation_plan(&store).unwrap();
    assert_eq!(plan.pages[0].id, "written:overview");
    assert!(plan.pages.iter().all(|p| p.state == PageState::Missing));
    assert!(plan.input_tokens > 0);

    let brief = entry
        .documentation_brief(&store, "written:overview")
        .unwrap();
    assert!(brief.prompt.contains("# Code excerpts"));
    assert!(brief.system.contains("Never invent"));
    assert!(brief.prewritten.is_none());

    // The model's own references are not trusted: names the evidence lacks become plain text.
    let view = entry
        .documentation_save(
            &store,
            "written:overview",
            "## What the crate is\nThe crate links `src/a.rs` and `src/b.rs`; `src/ghost.rs` is invented.",
            "test-model",
        )
        .unwrap();
    assert_eq!(view.page.dropped, 1);
    assert!(view
        .page
        .markdown
        .contains("`src/a.rs` and `src/b.rs`; src/ghost.rs is invented"));
    assert_eq!(view.page.author.model, "test-model");

    let stored = entry
        .documentation_page(&store, "written:overview")
        .unwrap()
        .unwrap();
    assert_eq!(stored.page.markdown, view.page.markdown);
    assert!(entry
        .documentation_page(&store, "written:architecture")
        .unwrap()
        .is_none());
    let plan = entry.documentation_plan(&store).unwrap();
    assert_eq!(plan.pages[0].state, PageState::Fresh);

    // An empty answer is refused rather than stored.
    let none = entry
        .documentation_save(&store, "written:architecture", "  \n ", "m")
        .unwrap_err();
    assert_eq!(none.code, "nothing_valid");

    // A file it was written from changes: the page is no longer fresh.
    write(
        dir.path(),
        "src/a.rs",
        "use crate::b::B;\npub struct A;\npub fn changed() {}\n",
    );
    write(
        dir.path(),
        "src/b.rs",
        "use crate::a::A;\npub struct B;\npub fn changed() {}\n",
    );
    entry.refresh(true).await.unwrap();
    let after = entry
        .documentation_page(&store, "written:overview")
        .unwrap()
        .unwrap();
    assert_ne!(
        after.freshness,
        harness_repository_wiki::written::Freshness::Fresh
    );
}

#[tokio::test]
async fn the_model_and_style_are_kept_per_repository() {
    let (_dir, entry) = ready().await;
    let data = tempfile::tempdir().unwrap();
    let store = store_path(data.path(), entry.root());
    assert!(documentation_settings(&store).unwrap().model.is_none());
    set_documentation_settings(
        &store,
        DocumentationSettings {
            model: Some("m1".into()),
            style: Some("tutorial".into()),
        },
    )
    .unwrap();
    let settings = documentation_settings(&store).unwrap();
    assert_eq!(settings.model.as_deref(), Some("m1"));
    let brief = entry
        .documentation_brief(&store, "written:overview")
        .unwrap();
    assert_eq!(brief.style, "tutorial");
}
