//! `HostWorkspace`: the `harness_workspace::Workspace` implementation that
//! routes file reads/writes through the IDE via `HostBridge`, instead of
//! touching disk directly.
//!
//! This is the Milestone B stand-in for the node-scoped VFS overlay
//! `agentRunCoordinator.ts` already implements in TypeScript
//! (HARNESS_CONTRACT_PLAN.md decision 3: that logic stays in TypeScript,
//! not Rust -- a `HostWorkspace` is the same host round-trip the sidecar's
//! `read_file`/`write_file` reverse-RPC already does, just over a Tauri
//! `Channel` instead of a WebSocket). `search`/`list_files` bypass the
//! bridge entirely and hit real disk, mirroring the sidecar's own split
//! (`read_file`/`write_file` go through the host; `list_files`/
//! `search_codebase` are disk-only, `agent-sidecar/src/services/tools.ts`).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use harness_workspace::{FileInfo, FsWorkspace, SearchResult, Workspace, WorkspaceError, WorkspaceMode};
use serde_json::json;
use tokio_util::sync::CancellationToken;

use super::host_bridge::HostBridge;

pub struct HostWorkspace {
    root: PathBuf,
    bridge: Arc<HostBridge>,
    disk: FsWorkspace,
}

impl HostWorkspace {
    pub fn new(root: PathBuf, bridge: Arc<HostBridge>) -> Self {
        let disk = FsWorkspace::new(root.clone());
        Self { root, bridge, disk }
    }

    /// rusty-core's `Workspace` trait takes root-relative paths
    /// (`harness-workspace/src/workspace.rs`'s doc comments); the IDE's
    /// `RunHost` contract (`src/harness/contract/host.ts`) takes absolute
    /// ones. This is the one place that translates between them.
    fn absolute(&self, relative_path: &str) -> PathBuf {
        let path = crate::resolve_path(relative_path);
        if path.is_absolute() {
            path
        } else {
            self.root.join(relative_path)
        }
    }
}

#[async_trait]
impl Workspace for HostWorkspace {
    fn root(&self) -> &Path {
        &self.root
    }

    fn mode(&self) -> WorkspaceMode {
        WorkspaceMode::Shared
    }

    async fn read(&self, relative_path: &str) -> Result<String, WorkspaceError> {
        // `Workspace::read` carries no cancellation token of its own, so
        // this round trip can't be cancelled through this path -- a real
        // limit, but one the trait itself imposes equally on every
        // implementor, not something specific to routing through the host.
        let absolute = self.absolute(relative_path);
        let result = self
            .bridge
            .call(
                "workspace.read",
                json!({ "path": absolute.to_string_lossy() }),
                &CancellationToken::new(),
            )
            .await
            .map_err(WorkspaceError::ToolFailed)?;
        result
            .get("content")
            .and_then(|value| value.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| WorkspaceError::ToolFailed("host returned no content".to_string()))
    }

    async fn write(&self, relative_path: &str, content: &str) -> Result<(), WorkspaceError> {
        let absolute = self.absolute(relative_path);
        self.bridge
            .call(
                "workspace.write",
                json!({ "path": absolute.to_string_lossy(), "content": content }),
                &CancellationToken::new(),
            )
            .await
            .map(|_| ())
            .map_err(WorkspaceError::ToolFailed)
    }

    async fn search(&self, query: &str) -> Result<SearchResult, WorkspaceError> {
        self.disk.search(query).await
    }

    async fn list_files(&self, max_depth: usize) -> Result<Vec<FileInfo>, WorkspaceError> {
        self.disk.list_files(max_depth).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::harness::bridge_event::BridgeEvent;
    use tokio::sync::mpsc;

    #[tokio::test]
    async fn read_translates_a_relative_path_to_an_absolute_one_under_root() {
        let (tx, mut outbound) = mpsc::unbounded_channel();
        let bridge = Arc::new(HostBridge::new(tx));
        let root = PathBuf::from("/workspace/root");
        let workspace = HostWorkspace::new(root.clone(), bridge.clone());

        let read_future = workspace.read("sub/file.txt");
        tokio::pin!(read_future);

        let event = tokio::select! {
            event = outbound.recv() => event.expect("read() issued a HostToolCall"),
            _ = &mut read_future => panic!("read() resolved before its call was answered"),
        };
        let BridgeEvent::HostToolCall { call_id, tool, input } = event else {
            panic!("expected a HostToolCall event");
        };
        assert_eq!(tool, "workspace.read");
        assert_eq!(
            input.get("path").and_then(|v| v.as_str()),
            Some(root.join("sub/file.txt").to_string_lossy().as_ref()),
        );

        bridge.complete(&call_id, Ok(json!({"content": "hello from the host"})));

        let content = read_future.await.expect("read() should resolve once completed");
        assert_eq!(content, "hello from the host");
    }

    #[tokio::test]
    async fn write_translates_a_relative_path_and_forwards_content() {
        let (tx, mut outbound) = mpsc::unbounded_channel();
        let bridge = Arc::new(HostBridge::new(tx));
        let root = PathBuf::from("/workspace/root");
        let workspace = HostWorkspace::new(root.clone(), bridge.clone());

        let write_future = workspace.write("sub/file.txt", "new content");
        tokio::pin!(write_future);

        let event = tokio::select! {
            event = outbound.recv() => event.expect("write() issued a HostToolCall"),
            _ = &mut write_future => panic!("write() resolved before its call was answered"),
        };
        let BridgeEvent::HostToolCall { call_id, tool, input } = event else {
            panic!("expected a HostToolCall event");
        };
        assert_eq!(tool, "workspace.write");
        assert_eq!(
            input.get("path").and_then(|v| v.as_str()),
            Some(root.join("sub/file.txt").to_string_lossy().as_ref()),
        );
        assert_eq!(input.get("content").and_then(|v| v.as_str()), Some("new content"));

        bridge.complete(&call_id, Ok(json!(null)));
        write_future.await.expect("write() should resolve once completed");
    }

    #[tokio::test]
    async fn read_surfaces_a_host_failure_as_a_tool_failed_workspace_error() {
        let (tx, mut outbound) = mpsc::unbounded_channel();
        let bridge = Arc::new(HostBridge::new(tx));
        let workspace = HostWorkspace::new(PathBuf::from("/root"), bridge.clone());

        let read_future = workspace.read("missing.txt");
        tokio::pin!(read_future);

        let event = tokio::select! {
            event = outbound.recv() => event.expect("read() issued a HostToolCall"),
            _ = &mut read_future => panic!("resolved too early"),
        };
        let BridgeEvent::HostToolCall { call_id, .. } = event else {
            panic!("expected a HostToolCall event");
        };
        bridge.complete(&call_id, Err("ENOENT".to_string()));

        let error = read_future.await.expect_err("a host failure must surface as an error");
        assert!(matches!(error, WorkspaceError::ToolFailed(message) if message == "ENOENT"));
    }

    #[tokio::test]
    async fn root_is_returned_unchanged() {
        let (tx, _outbound) = mpsc::unbounded_channel();
        let bridge = Arc::new(HostBridge::new(tx));
        let root = PathBuf::from("/some/workspace");
        let workspace = HostWorkspace::new(root.clone(), bridge);
        assert_eq!(workspace.root(), root.as_path());
    }
}
