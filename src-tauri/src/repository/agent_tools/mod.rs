//! Repository tools for the agent loop, shaped around the questions an agent asks:
//! `repo_overview` (what is this repository), `repo_health` (how healthy is it, and is the file I
//! just edited better or worse), `repo_risk` (is it risky to touch, and what may a change break),
//! `repo_symbol` (one function's body), and `repo_context` with the host's extensions (several
//! targets at once, symbols, a skeleton, health and owners). All read only; all answer with the
//! shared [`envelope`].
mod context;
pub mod envelope;
mod health;
mod overview;
mod risk;
pub mod source;
mod symbol;

use std::sync::Arc;

use serde_json::Value;

use super::{entry::Entry, error::RepositoryError};

/// The tools answered here rather than by the core tool set.
pub const HOST_TOOLS: [&str; 4] = ["repo_overview", "repo_health", "repo_risk", "repo_symbol"];

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, RepositoryError> + Send + 'static,
) -> Result<T, RepositoryError> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| RepositoryError::new("internal", error.to_string()))?
}

/// Runs one agent tool for `entry`, building the index first when there is none.
pub async fn run(
    entry: Arc<Entry>,
    tool: &str,
    arguments: Value,
) -> Result<Value, RepositoryError> {
    if !HOST_TOOLS.contains(&tool) && tool != "repo_context" {
        return entry.agent_tool(tool, arguments).await;
    }
    if entry.graph.current().is_none() {
        entry.refresh(true).await?;
    }
    match tool {
        "repo_context" => context::run(entry, arguments).await,
        "repo_overview" => {
            // The folder map (entry points, most depended-on files) comes from the core tool.
            let orient = entry
                .agent_tool(
                    "repo_context",
                    serde_json::json!({"mode": "orient", "target": ""}),
                )
                .await
                .ok();
            blocking(move || overview::run(&entry, arguments, orient)).await
        }
        "repo_health" => blocking(move || health::run(&entry, arguments)).await,
        "repo_risk" => blocking(move || risk::run(&entry, arguments)).await,
        "repo_symbol" => blocking(move || symbol::run(&entry, arguments)).await,
        _ => unreachable!("checked above"),
    }
}
