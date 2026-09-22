//! `HostToolExecutor`: a `ToolExecutor` that forwards every call to the IDE
//! via `HostBridge`, for tools the IDE itself implements (e.g. a future
//! `ask_user_question`/`report_progress`/`write_plan` host tool, Milestone
//! C) rather than ones rusty-core has a built-in executor for
//! (`SessionBuilder::build_executor_for`'s `fs.*`/`shell.*`/`git.*`/
//! `web.fetch`).

use std::sync::Arc;

use async_trait::async_trait;
use harness_tools::{CancellationToken, ToolDescriptor, ToolError, ToolExecutor, ToolInput, ToolResult};
use serde_json::json;

use super::host_bridge::HostBridge;

pub struct HostToolExecutor {
    descriptor: ToolDescriptor,
    bridge: Arc<HostBridge>,
}

impl HostToolExecutor {
    pub fn new(descriptor: ToolDescriptor, bridge: Arc<HostBridge>) -> Self {
        Self { descriptor, bridge }
    }
}

#[async_trait]
impl ToolExecutor for HostToolExecutor {
    fn descriptor(&self) -> ToolDescriptor {
        self.descriptor.clone()
    }

    /// Never returns `Err(ToolError)` for a host-side failure -- only for
    /// infrastructure failures this executor itself can't classify, which
    /// in practice is none (`HostBridge::call` already normalizes
    /// everything into `Result<Value, String>`). A failure the model
    /// should actually see comes back as `Ok(ToolResult{is_error: true,
    /// output: {"error": ...}})`, matching the sidecar's own read_file/
    /// write_file reverse-RPC error convention.
    async fn execute(
        &self,
        input: ToolInput,
        cancel: CancellationToken,
    ) -> Result<ToolResult, ToolError> {
        let tool_name = self.descriptor.id.as_str().to_string();
        match self.bridge.call(&tool_name, input.arguments, &cancel).await {
            Ok(output) => Ok(ToolResult {
                call_id: tool_name,
                output,
                is_error: false,
            }),
            Err(reason) => Ok(ToolResult {
                call_id: tool_name,
                output: json!({ "error": reason }),
                is_error: true,
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::harness::bridge_event::BridgeEvent;
    use tokio::sync::mpsc;

    fn descriptor(id: &str) -> ToolDescriptor {
        ToolDescriptor {
            id: harness_tools::ToolId::new(id),
            name: id.to_string(),
            description: "a host-implemented tool".to_string(),
            input_schema: json!({}),
        }
    }

    #[tokio::test]
    async fn a_successful_host_answer_becomes_a_non_error_tool_result() {
        let (tx, mut outbound) = mpsc::unbounded_channel();
        let bridge = Arc::new(HostBridge::new(tx));
        let executor = HostToolExecutor::new(descriptor("ask_user_question"), bridge.clone());

        let execute_future = executor.execute(
            ToolInput { arguments: json!({"question": "Which model?"}) },
            CancellationToken::new(),
        );
        tokio::pin!(execute_future);

        let event = tokio::select! {
            event = outbound.recv() => event.expect("execute() issued a HostToolCall"),
            _ = &mut execute_future => panic!("resolved before it was answered"),
        };
        let BridgeEvent::HostToolCall { call_id, tool, input } = event else {
            panic!("expected a HostToolCall event");
        };
        assert_eq!(tool, "ask_user_question");
        assert_eq!(input, json!({"question": "Which model?"}));

        bridge.complete(&call_id, Ok(json!({"answer": "opus"})));

        let result = execute_future.await.expect("infrastructure-level Err was not expected");
        assert!(!result.is_error);
        assert_eq!(result.output, json!({"answer": "opus"}));
    }

    #[tokio::test]
    async fn a_host_failure_becomes_an_error_tool_result_not_an_err() {
        let (tx, mut outbound) = mpsc::unbounded_channel();
        let bridge = Arc::new(HostBridge::new(tx));
        let executor = HostToolExecutor::new(descriptor("write_plan"), bridge.clone());

        let execute_future = executor.execute(ToolInput { arguments: json!({}) }, CancellationToken::new());
        tokio::pin!(execute_future);

        let event = tokio::select! {
            event = outbound.recv() => event.expect("execute() issued a HostToolCall"),
            _ = &mut execute_future => panic!("resolved too early"),
        };
        let BridgeEvent::HostToolCall { call_id, .. } = event else {
            panic!("expected a HostToolCall event");
        };
        bridge.complete(&call_id, Err("plan filename was invalid".to_string()));

        let result = execute_future.await.expect("a host failure is Ok(ToolResult{is_error:true}), not Err");
        assert!(result.is_error);
        assert_eq!(result.output, json!({"error": "plan filename was invalid"}));
    }

    #[tokio::test]
    async fn cancelling_the_token_surfaces_as_an_error_tool_result() {
        let (tx, mut outbound) = mpsc::unbounded_channel();
        let bridge = Arc::new(HostBridge::new(tx));
        let executor = HostToolExecutor::new(descriptor("report_progress"), bridge);
        let cancel = CancellationToken::new();

        let execute_future = executor.execute(ToolInput { arguments: json!({}) }, cancel.clone());
        tokio::pin!(execute_future);

        let _ = tokio::select! {
            event = outbound.recv() => event,
            _ = &mut execute_future => panic!("resolved too early"),
        };
        cancel.cancel();

        let result = tokio::time::timeout(std::time::Duration::from_secs(1), execute_future)
            .await
            .expect("cancel must unblock execute() promptly")
            .expect("cancellation is Ok(ToolResult{is_error:true}), not Err");
        assert!(result.is_error);
        assert_eq!(result.output, json!({"error": "cancelled"}));
    }
}
