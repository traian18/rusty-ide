//! Readable documentation for one repository: the plan, the brief a model writes from, and the
//! pages it wrote, kept in the app data directory (never in the repository).
//!
//! The model call itself happens in the frontend, through the chat model routing; the host builds
//! the brief and checks what comes back, so a page only holds text its sources support.
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use harness_repository_wiki::written::{
    Author, BriefBuilder, BriefContext, Diagram, Freshness, Style, WrittenPage,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::{entry::Entry, error::RepositoryError, persisted_state};

/// Rough characters per token, for the estimate shown before anything is spent.
const CHARS_PER_TOKEN: usize = 4;

/// What the user chose for this repository. Empty means "use the workspace default".
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentationSettings {
    pub model: Option<String>,
    pub style: Option<String>,
}

#[derive(Debug, Default, Deserialize, Serialize)]
struct Document {
    #[serde(default)]
    settings: DocumentationSettings,
    #[serde(default)]
    pages: BTreeMap<String, WrittenPage>,
}

/// `<app data>/documentation/<hash of the canonical root>.json`.
pub fn store_path(app_data_dir: &Path, root: &Path) -> PathBuf {
    let digest = Sha256::digest(root.to_string_lossy().as_bytes());
    let name: String = digest.iter().take(8).map(|b| format!("{b:02x}")).collect();
    app_data_dir
        .join("documentation")
        .join(format!("{name}.json"))
}

fn load(store: &Path) -> Result<Document, RepositoryError> {
    match persisted_state::load(store)? {
        Some(value) => serde_json::from_value(value).map_err(|error| {
            RepositoryError::new("corrupt_state", format!("saved documentation: {error}"))
        }),
        None => Ok(Document::default()),
    }
}

fn save(store: &Path, document: &Document) -> Result<(), RepositoryError> {
    let value = serde_json::to_value(document)
        .map_err(|error| RepositoryError::invalid(error.to_string()))?;
    persisted_state::save(store, &value)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedPage {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub files: usize,
    /// Estimated input tokens for writing this page now.
    pub input_tokens: usize,
    pub state: PageState,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PageState {
    Missing,
    Fresh,
    Stale,
    Expired,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentationPlan {
    pub pages: Vec<PlannedPage>,
    pub input_tokens: usize,
    pub settings: DocumentationSettings,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagramView {
    pub key: String,
    pub title: String,
    pub svg: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WrittenView {
    pub page: WrittenPage,
    pub freshness: Freshness,
    pub diagrams: Vec<DiagramView>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageRef {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitPages {
    pub commit: String,
    pub files: Vec<String>,
    pub pages: Vec<PageRef>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingDocumentation {
    pub pages: Vec<String>,
    pub model: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BriefView {
    pub id: String,
    pub title: String,
    pub system: String,
    pub prompt: String,
    pub input_chars: usize,
    pub style: String,
    /// A page built without a model (the glossary): save it as it is.
    pub prewritten: Option<String>,
}

fn view_diagrams(diagrams: Vec<Diagram>) -> Vec<DiagramView> {
    diagrams
        .into_iter()
        .map(|d| DiagramView {
            key: d.key,
            title: d.title,
            svg: d.svg,
        })
        .collect()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

impl Entry {
    fn brief_builder(&self) -> BriefBuilder {
        BriefBuilder::new(self.page_renderer())
    }

    fn brief_context(&self, document: &Document) -> BriefContext {
        BriefContext {
            repository_name: self.root.file_name().map_or_else(
                || "repository".to_owned(),
                |n| n.to_string_lossy().into_owned(),
            ),
            style: Style::parse(document.settings.style.as_deref().unwrap_or_default()),
            written: document
                .pages
                .iter()
                .map(|(id, page)| (id.clone(), page.markdown.clone()))
                .collect(),
        }
    }

    /// What could be written, what each page would cost, and how current the written ones are.
    pub fn documentation_plan(&self, store: &Path) -> Result<DocumentationPlan, RepositoryError> {
        let document = load(store)?;
        let builder = self.brief_builder();
        let context = self.brief_context(&document);
        let mut pages = Vec::new();
        for target in builder.targets()? {
            let brief = builder.brief(&target.id, &context)?;
            let state = match document.pages.get(&target.id) {
                None => PageState::Missing,
                Some(page) => match builder.freshness_of(page)? {
                    Freshness::Fresh => PageState::Fresh,
                    Freshness::Stale => PageState::Stale,
                    Freshness::Expired => PageState::Expired,
                },
            };
            pages.push(PlannedPage {
                kind: serde_json::to_value(target.kind)
                    .ok()
                    .and_then(|v| v.as_str().map(str::to_owned))
                    .unwrap_or_default(),
                id: target.id,
                title: target.title,
                files: target.files,
                input_tokens: brief.input_chars / CHARS_PER_TOKEN,
                state,
            });
        }
        let input_tokens = pages
            .iter()
            .filter(|p| p.state != PageState::Fresh)
            .map(|p| p.input_tokens)
            .sum();
        Ok(DocumentationPlan {
            pages,
            input_tokens,
            settings: document.settings,
        })
    }

    pub fn documentation_brief(
        &self,
        store: &Path,
        id: &str,
    ) -> Result<BriefView, RepositoryError> {
        let document = load(store)?;
        let context = self.brief_context(&document);
        let brief = self.brief_builder().brief(id, &context)?;
        Ok(BriefView {
            id: brief.id,
            title: brief.title,
            system: brief.system,
            prompt: brief.prompt,
            input_chars: brief.input_chars,
            style: context.style.name().to_owned(),
            prewritten: brief.prewritten,
        })
    }

    /// Checks `markdown` against the brief for `id` as it is now and stores what holds up.
    pub fn documentation_save(
        &self,
        store: &Path,
        id: &str,
        markdown: &str,
        model: &str,
    ) -> Result<WrittenView, RepositoryError> {
        let mut document = load(store)?;
        let context = self.brief_context(&document);
        let builder = self.brief_builder();
        let brief = builder.brief(id, &context)?;
        let author = Author {
            model: model.to_owned(),
            style: context.style.name().to_owned(),
            written_at_ms: now_ms(),
            commit: None,
        };
        let page = builder.assemble(&brief, markdown, author);
        if page.markdown.trim().is_empty() {
            return Err(RepositoryError::new(
                "nothing_valid",
                "the answer was empty",
            ));
        }
        document.pages.insert(id.to_owned(), page.clone());
        save(store, &document)?;
        Ok(WrittenView {
            page,
            freshness: Freshness::Fresh,
            diagrams: view_diagrams(brief.diagrams),
        })
    }

    pub fn documentation_page(
        &self,
        store: &Path,
        id: &str,
    ) -> Result<Option<WrittenView>, RepositoryError> {
        let document = load(store)?;
        let Some(page) = document.pages.get(id).cloned() else {
            return Ok(None);
        };
        let builder = self.brief_builder();
        let freshness = builder.freshness_of(&page)?;
        let diagrams = view_diagrams(builder.diagrams(id)?);
        Ok(Some(WrittenView {
            page,
            freshness,
            diagrams,
        }))
    }
}

pub fn documentation_settings(store: &Path) -> Result<DocumentationSettings, RepositoryError> {
    Ok(load(store)?.settings)
}

pub fn set_documentation_settings(
    store: &Path,
    settings: DocumentationSettings,
) -> Result<(), RepositoryError> {
    let mut document = load(store)?;
    document.settings = settings;
    save(store, &document)
}

/// Pages already written that were built from any of `files` (or name them), so a change to those
/// files makes them worth updating.
pub fn pages_touching(
    store: &Path,
    files: &[String],
) -> Result<Vec<(String, String)>, RepositoryError> {
    let document = load(store)?;
    let wanted: std::collections::HashSet<&str> = files.iter().map(String::as_str).collect();
    Ok(document
        .pages
        .values()
        .filter(|page| {
            page.inputs.iter().any(|i| wanted.contains(i.file.as_str()))
                || page.footnotes.iter().any(|f| match &f.reference {
                    harness_repository_wiki::written::SourceRef::Lines { citation } => {
                        wanted.contains(citation.file.as_str())
                    }
                    _ => false,
                })
        })
        .map(|page| (page.id.clone(), page.title.clone()))
        .collect())
}

/// The files the newest commit changed, and its id.
pub fn files_in_head(root: &Path) -> Result<(String, Vec<String>), RepositoryError> {
    let failed = |e: git2::Error| RepositoryError::new("git_error", e.message().to_owned());
    let repo = git2::Repository::discover(root).map_err(failed)?;
    let head = repo
        .head()
        .and_then(|h| h.peel_to_commit())
        .map_err(failed)?;
    let tree = head.tree().map_err(failed)?;
    let parent = head.parent(0).ok().and_then(|p| p.tree().ok());
    let diff = repo
        .diff_tree_to_tree(parent.as_ref(), Some(&tree), None)
        .map_err(failed)?;
    let workdir = repo.workdir().map(Path::to_path_buf).unwrap_or_default();
    let prefix = root
        .strip_prefix(&workdir)
        .unwrap_or(Path::new(""))
        .to_path_buf();
    let mut files: Vec<String> = diff
        .deltas()
        .filter_map(|d| {
            d.new_file()
                .path()
                .or_else(|| d.old_file().path())
                .map(Path::to_path_buf)
        })
        .filter_map(|p| {
            p.strip_prefix(&prefix)
                .ok()
                .map(|r| r.to_string_lossy().replace('\\', "/"))
        })
        .collect();
    files.sort();
    files.dedup();
    Ok((head.id().to_string(), files))
}
