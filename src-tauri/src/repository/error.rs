//! Structured errors for repository commands: a stable code plus a message, the same codes the
//! agent tools use so a failure reads the same wherever it surfaces.
use harness_findings::{FindingsError, FindingsQueryError};
use harness_git_analysis::{GitAnalysisError, GitQueryError};
use harness_workspace::dependency_groups::GroupQueryError;
use harness_workspace::import_graph::ImportQueryError;
use harness_workspace::repository_intelligence::DiscoveryError;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct RepositoryError {
    pub code: String,
    pub message: String,
}

impl RepositoryError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_owned(),
            message: message.into(),
        }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new("invalid_request", message)
    }

    pub fn no_snapshot() -> Self {
        Self::new(
            "snapshot_not_found",
            "no repository snapshot has been built yet; refresh the repository first",
        )
    }
}

impl From<DiscoveryError> for RepositoryError {
    fn from(error: DiscoveryError) -> Self {
        let code = match &error {
            DiscoveryError::Cancelled => "cancelled",
            DiscoveryError::SnapshotNotFound(_) => "snapshot_not_found",
            DiscoveryError::InvalidRelativePath(_) => "invalid_request",
            DiscoveryError::Failed(_) => "dependency_failure",
        };
        Self::new(code, error.to_string())
    }
}

impl From<ImportQueryError> for RepositoryError {
    fn from(error: ImportQueryError) -> Self {
        let code = match &error {
            ImportQueryError::SnapshotNotFound(_) => "snapshot_not_found",
            ImportQueryError::InvalidLimit { .. } => "limit_exceeded",
            ImportQueryError::ForeignCursor | ImportQueryError::InvalidCursor => "invalid_cursor",
            ImportQueryError::UnknownFile(_) => "unknown_file",
            ImportQueryError::InvalidQuery(_) => "invalid_request",
        };
        Self::new(code, error.to_string())
    }
}

impl From<GroupQueryError> for RepositoryError {
    fn from(error: GroupQueryError) -> Self {
        let code = match &error {
            GroupQueryError::SnapshotNotFound(_) => "snapshot_not_found",
            GroupQueryError::NotConfigured => "not_configured",
            GroupQueryError::InvalidLimit { .. } => "limit_exceeded",
            GroupQueryError::ForeignCursor | GroupQueryError::InvalidCursor => "invalid_cursor",
            GroupQueryError::UnknownGroup(_) => "unknown_group",
            GroupQueryError::UnknownFile(_) => "unknown_file",
            GroupQueryError::InvalidQuery(_) => "invalid_request",
        };
        Self::new(code, error.to_string())
    }
}

impl From<harness_workspace::framework_relations::FrameworkQueryError> for RepositoryError {
    fn from(error: harness_workspace::framework_relations::FrameworkQueryError) -> Self {
        use harness_workspace::framework_relations::FrameworkQueryError as E;
        let code = match &error {
            E::NotConfigured => "not_configured",
            E::SnapshotNotFound(_) => "snapshot_not_found",
            E::InvalidLimit { .. } => "limit_exceeded",
            E::ForeignCursor | E::InvalidCursor => "invalid_cursor",
        };
        Self::new(code, error.to_string())
    }
}

impl From<GitAnalysisError> for RepositoryError {
    fn from(error: GitAnalysisError) -> Self {
        let code = match &error {
            GitAnalysisError::Cancelled => "cancelled",
            GitAnalysisError::InvalidConfig(_) => "invalid_request",
            GitAnalysisError::NotARepository(_) => "not_a_git_repository",
            GitAnalysisError::Failed(_) => "dependency_failure",
        };
        Self::new(code, error.to_string())
    }
}

impl From<GitQueryError> for RepositoryError {
    fn from(error: GitQueryError) -> Self {
        let code = match &error {
            GitQueryError::SnapshotNotFound(_) => "snapshot_not_found",
            GitQueryError::InvalidLimit { .. } => "limit_exceeded",
            GitQueryError::ForeignCursor | GitQueryError::InvalidCursor => "invalid_cursor",
            GitQueryError::UnknownFile(_) => "unknown_file",
            GitQueryError::InvalidQuery(_) => "invalid_request",
        };
        Self::new(code, error.to_string())
    }
}

impl From<FindingsError> for RepositoryError {
    fn from(error: FindingsError) -> Self {
        let code = match &error {
            FindingsError::Cancelled => "cancelled",
            FindingsError::InvalidConfig(_) => "invalid_request",
            FindingsError::RepositorySnapshotNotFound(_)
            | FindingsError::NoRepositorySnapshot
            | FindingsError::GitSnapshotNotFound(_) => "snapshot_not_found",
            FindingsError::Failed(_) => "dependency_failure",
        };
        Self::new(code, error.to_string())
    }
}

impl From<FindingsQueryError> for RepositoryError {
    fn from(error: FindingsQueryError) -> Self {
        let code = match &error {
            FindingsQueryError::SetNotFound(_) => "snapshot_not_found",
            FindingsQueryError::FindingNotFound(_) => "finding_not_found",
            FindingsQueryError::InvalidLimit { .. } => "limit_exceeded",
            FindingsQueryError::ForeignCursor | FindingsQueryError::InvalidCursor => {
                "invalid_cursor"
            }
        };
        Self::new(code, error.to_string())
    }
}
