//! Rebuilding the repository snapshot, then Git history and findings on top of it.
use harness_findings::AnalyzeRequest;
use harness_git_analysis::RepositoryCorrelation;
use tokio_util::sync::CancellationToken;

use super::{
    dto::{OpenResponse, RefreshResponse, StageError},
    entry::Entry,
    error::RepositoryError,
    summaries::{findings_status, git_summary, snapshot_summary},
};

impl Entry {
    /// What the UI shows when a workspace is opened: whatever is already built.
    pub fn open_response(&self) -> OpenResponse {
        OpenResponse {
            root: self.root.display().to_string(),
            discovery: self.graph.capabilities(),
            snapshot: self
                .graph
                .current()
                .map(|snapshot| snapshot_summary(&snapshot)),
            git: self.git.current().map(|snapshot| git_summary(&snapshot)),
            findings: self.findings.current().map(|set| findings_status(&set)),
            built_at_ms: self.built_at_ms(),
        }
    }

    /// Rescans the repository. Git and findings follow; their failures are reported as stage
    /// errors and do not invalidate the repository snapshot.
    pub async fn refresh(&self, include_git: bool) -> Result<RefreshResponse, RepositoryError> {
        // Waits its turn: only a few repositories are indexed at a time.
        let _turn = self
            .indexing
            .acquire()
            .await
            .map_err(|_| RepositoryError::new("cancelled", "indexing was shut down"))?;
        let cancel = self.begin_refresh();
        let snapshot = self.graph.refresh(cancel.clone()).await?;
        let built_at_ms = self.record_built_now();
        let mut stage_errors = Vec::new();

        let git = if include_git {
            let correlation = RepositoryCorrelation::from_snapshot(&snapshot);
            match self.git.refresh(correlation, cancel.clone()).await {
                Ok(git) => Some(git_summary(&git)),
                Err(error) => {
                    stage_errors.push(stage("git", error.into()));
                    None
                }
            }
        } else {
            None
        };

        let findings = self
            .analyze_findings(include_git, &cancel, &mut stage_errors)
            .await;
        Ok(RefreshResponse {
            snapshot: snapshot_summary(&snapshot),
            git,
            findings,
            built_at_ms,
            stage_errors,
        })
    }

    /// The response a refresh would give, from what is built now (after a background analysis).
    pub fn current_response(&self) -> Result<RefreshResponse, RepositoryError> {
        let snapshot = self.snapshot()?;
        Ok(RefreshResponse {
            snapshot: snapshot_summary(&snapshot),
            git: self.git.current().map(|g| git_summary(&g)),
            findings: self.findings.current().map(|set| findings_status(&set)),
            built_at_ms: self.built_at_ms().unwrap_or_default(),
            stage_errors: Vec::new(),
        })
    }

    /// Findings are cheap to derive, so they are not stored: recompute them from the snapshots an
    /// earlier run saved.
    pub async fn restore_findings(&self) {
        if self.graph.current().is_none() || self.findings.current().is_some() {
            return;
        }
        let request = AnalyzeRequest {
            use_git: self.git.current().is_some(),
            ..AnalyzeRequest::default()
        };
        let _ = self
            .findings
            .analyze(request, CancellationToken::new())
            .await;
    }

    async fn analyze_findings(
        &self,
        use_git: bool,
        cancel: &CancellationToken,
        stage_errors: &mut Vec<StageError>,
    ) -> Option<super::dto::FindingsStatus> {
        let request = AnalyzeRequest {
            use_git,
            ..AnalyzeRequest::default()
        };
        match self.findings.analyze(request, cancel.clone()).await {
            Ok(set) => Some(findings_status(&set)),
            Err(error) => {
                stage_errors.push(stage("findings", error.into()));
                None
            }
        }
    }
}

fn stage(name: &str, error: RepositoryError) -> StageError {
    StageError {
        stage: name.to_owned(),
        code: error.code,
        message: error.message,
    }
}
