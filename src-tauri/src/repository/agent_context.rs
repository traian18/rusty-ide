//! `repo_context` and `repo_wiki` for the agent tools: the same tools the engine exposes, run against this
//! workspace's repository services. It reads and indexes only; it never changes a file.
use harness_tool_repository_intelligence::RepositoryIntelligence;
use harness_tools::{CancellationToken, ToolInput};
use serde_json::Value;

use super::{entry::Entry, error::RepositoryError};

impl Entry {
    /// Runs one `repo_context` call. Builds the snapshot first when there is none, and refreshes
    /// once and asks again when the first answer is `stale`.
    pub async fn agent_context(&self, arguments: Value) -> Result<Value, RepositoryError> {
        self.agent_tool("repo_context", arguments).await
    }

    /// Runs one read-only repository tool (`repo_context` or `repo_wiki`) for an agent, with the
    /// same build-when-missing and refresh-when-stale behaviour.
    pub async fn agent_tool(&self, tool: &str, arguments: Value) -> Result<Value, RepositoryError> {
        if self.graph.current().is_none() {
            self.refresh(true).await?;
        }
        let output = self.run_tool(tool, arguments.clone()).await?;
        if output["result"]["status"] == "stale" {
            self.refresh(true).await?;
            return self.run_tool(tool, arguments).await;
        }
        Ok(output)
    }

    async fn run_tool(&self, tool: &str, arguments: Value) -> Result<Value, RepositoryError> {
        let tools = RepositoryIntelligence::new()
            .with_graph(self.graph.clone())
            .with_git(self.git.clone())
            .with_findings(self.findings.clone());
        let executor = tools.executor_for(tool).ok_or_else(|| {
            RepositoryError::new("not_configured", format!("{tool} is not available"))
        })?;
        let result = executor
            .execute(ToolInput { arguments }, CancellationToken::new())
            .await
            .map_err(|error| RepositoryError::new("dependency_failure", format!("{error:?}")))?;
        if result.is_error {
            let error = &result.output["error"];
            return Err(RepositoryError::new(
                error["code"].as_str().unwrap_or("dependency_failure"),
                error["message"].as_str().unwrap_or("repo_context failed"),
            ));
        }
        Ok(result.output)
    }
}
