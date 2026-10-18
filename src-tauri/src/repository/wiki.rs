//! The documentation wiki for the Docs tab: pages and the tree, rendered from the snapshots.
use harness_repository_wiki::{Page, PageId, PageRenderer, TreeEntry, WikiError};

use super::{entry::Entry, error::RepositoryError};

impl From<WikiError> for RepositoryError {
    fn from(error: WikiError) -> Self {
        RepositoryError::new(error.code(), error.to_string())
    }
}

impl Entry {
    pub(super) fn page_renderer(&self) -> PageRenderer {
        PageRenderer::new(self.graph.clone())
            .with_git(self.git.clone())
            .with_findings(self.findings.clone())
    }

    /// One page. A repository that has not been built yet answers `snapshot_not_found`.
    pub fn wiki_page(&self, id: &str) -> Result<Page, RepositoryError> {
        Ok(self.page_renderer().page(&PageId(id.to_owned()), None)?)
    }

    /// The pages one level below `id`.
    pub fn wiki_children(&self, id: &str) -> Result<Vec<TreeEntry>, RepositoryError> {
        Ok(self
            .page_renderer()
            .children(&PageId(id.to_owned()), None)?)
    }
}
