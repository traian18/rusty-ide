//! A minimal JSON-RPC 2.0 client over a managed CLI's stdio: what both the
//! quota checks (`managed_quota.rs`) and the model listing
//! (`managed_models.rs`) talk to the vendored Copilot and Codex CLIs with.
//! `RpcChannel` is the protocol; `RpcChild` owns the process around it.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

use super::managed_binaries::resolve_managed_binary;

/// Per-request ceiling for one JSON-RPC round trip or HTTP call. The
/// sidecar used 20s for the same calls.
pub(super) const RPC_TIMEOUT: Duration = Duration::from_secs(20);

pub(super) fn binary_or_error(app: &AppHandle, provider: &str) -> Result<PathBuf, String> {
    resolve_managed_binary(app, provider)
        .ok_or_else(|| format!("The {provider} runtime is not installed. Sign in to download it."))
}

#[derive(Clone, Copy)]
pub(super) enum Framing {
    /// `Content-Length: N\r\n\r\n<body>` (vscode-jsonrpc; Copilot CLI).
    ContentLength,
    /// One JSON object per line (Codex app-server).
    NewlineDelimited,
}

/// One JSON-RPC conversation over a child's stdin and stdout.
pub(super) struct RpcChannel {
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    framing: Framing,
    next_id: i64,
}

impl RpcChannel {
    async fn write(&mut self, message: &Value) -> Result<(), String> {
        let body = serde_json::to_string(message).map_err(|e| e.to_string())?;
        let frame = match self.framing {
            Framing::ContentLength => format!("Content-Length: {}\r\n\r\n{body}", body.len()),
            Framing::NewlineDelimited => format!("{body}\n"),
        };
        self.stdin
            .write_all(frame.as_bytes())
            .await
            .map_err(|e| format!("failed to write to the CLI: {e}"))?;
        self.stdin
            .flush()
            .await
            .map_err(|e| format!("failed to write to the CLI: {e}"))
    }

    /// One line of output; an error once the CLI has closed it.
    async fn read_line(&mut self) -> Result<String, String> {
        let mut line = String::new();
        let read = self
            .stdout
            .read_line(&mut line)
            .await
            .map_err(|e| e.to_string())?;
        if read == 0 {
            return Err("the CLI closed its output before answering".to_string());
        }
        Ok(line)
    }

    /// Reads header lines up to the blank line that ends them, skipping
    /// blank lines before any Content-Length.
    async fn read_content_length(&mut self) -> Result<usize, String> {
        let mut length: Option<usize> = None;
        loop {
            let line = self.read_line().await?;
            let header = line.trim_end_matches(['\r', '\n']);
            if header.is_empty() && length.is_some() {
                break;
            }
            if let Some(value) = header.strip_prefix("Content-Length:") {
                length = value.trim().parse().ok();
            }
        }
        length.ok_or_else(|| "the CLI sent a frame without a Content-Length header".to_string())
    }

    async fn read_content_length_body(&mut self) -> Result<Vec<u8>, String> {
        let mut body = vec![0u8; self.read_content_length().await?];
        self.stdout
            .read_exact(&mut body)
            .await
            .map_err(|e| e.to_string())?;
        Ok(body)
    }

    /// Reads one framed message, skipping anything that isn't JSON (a
    /// stray log line on stdout, an empty line).
    async fn read_message(&mut self) -> Result<Value, String> {
        loop {
            let parsed = match self.framing {
                Framing::ContentLength => {
                    serde_json::from_slice::<Value>(&self.read_content_length_body().await?).ok()
                }
                Framing::NewlineDelimited => {
                    serde_json::from_str::<Value>(self.read_line().await?.trim()).ok()
                }
            };
            if let Some(value) = parsed {
                return Ok(value);
            }
        }
    }

    async fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        self.write(&json!({ "jsonrpc": "2.0", "method": method, "params": params }))
            .await
    }

    /// Sends `method` and waits for its response, answering any
    /// server-to-client request that arrives in between with
    /// MethodNotFound (nothing here implements a client-side API) and
    /// dropping notifications. Bounded by `RPC_TIMEOUT`.
    async fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        self.write(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))
            .await?;
        let wait = async {
            loop {
                let message = self.read_message().await?;
                let message_id = message.get("id").filter(|v| !v.is_null());
                let is_request = message.get("method").is_some();
                match (message_id, is_request) {
                    (Some(mid), false) if mid == &json!(id) => {
                        if let Some(error) = message.get("error") {
                            let text = error
                                .get("message")
                                .and_then(Value::as_str)
                                .map(str::to_string)
                                .unwrap_or_else(|| error.to_string());
                            return Err(format!("{method} failed: {text}"));
                        }
                        return Ok(message.get("result").cloned().unwrap_or(Value::Null));
                    }
                    (Some(mid), true) => {
                        let reply = json!({
                            "jsonrpc": "2.0",
                            "id": mid,
                            "error": { "code": -32601, "message": "not supported by this client" },
                        });
                        self.write(&reply).await?;
                    }
                    _ => {}
                }
            }
        };
        tokio::time::timeout(RPC_TIMEOUT, wait)
            .await
            .map_err(|_| format!("{method} timed out after {}s", RPC_TIMEOUT.as_secs()))?
    }
}

/// A managed CLI running as a JSON-RPC server, killed on `shutdown` (or drop).
pub(super) struct RpcChild {
    child: Child,
    channel: RpcChannel,
}

impl RpcChild {
    pub(super) async fn spawn(
        binary: &Path,
        args: &[&str],
        framing: Framing,
    ) -> Result<Self, String> {
        let mut child = Command::new(binary)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // The CLIs log to stderr; nothing here reads it, and an
            // unread pipe could block a chatty child, so let it flow to
            // the parent's stderr instead.
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| format!("failed to start {}: {error}", binary.display()))?;
        let stdin = child.stdin.take().ok_or("child stdin was not piped")?;
        let stdout = child.stdout.take().ok_or("child stdout was not piped")?;
        Ok(Self {
            child,
            channel: RpcChannel {
                stdin,
                stdout: BufReader::new(stdout),
                framing,
                next_id: 1,
            },
        })
    }

    pub(super) async fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        self.channel.notify(method, params).await
    }

    pub(super) async fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.channel.request(method, params).await
    }

    /// Stops the CLI and reaps it. Its answers are already in, so a failure
    /// here is only logged: `kill_on_drop` still covers a child that
    /// outlives this.
    pub(super) async fn shutdown(mut self) {
        if let Err(error) = self.child.start_kill() {
            eprintln!("Failed to stop the managed CLI: {error}");
        }
        if let Err(error) = self.child.wait().await {
            eprintln!("Failed to reap the managed CLI: {error}");
        }
    }
}
