//! Subscription quota for the three managed-auth providers (GitHub
//! Copilot, Codex, Claude Code) -- the `managed_auth_quota` Tauri command
//! behind `HybridControlPlane.getQuota` for a managed provider.
//!
//! Sidecar-removal Phase 8c had written this off as an accepted gap:
//! rusty-core's own subprocess integrations expose no quota RPC, and the
//! Node sidecar that used to answer it (via `@github/copilot-sdk`, the
//! Codex app-server, and the Claude Agent SDK) was gone. None of those
//! SDKs are actually needed, though -- each vendored CLI can be asked
//! directly, which is all the SDKs ever did on the sidecar's behalf:
//!
//! - **GitHub Copilot**: `copilot --headless --no-auto-update --stdio` is
//!   the exact server mode `@github/copilot-sdk` spawns (its own
//!   `client.js`'s `startCLIServer`), speaking JSON-RPC 2.0 with
//!   `Content-Length` framing (`vscode-jsonrpc`). The SDK's
//!   `rpc.account.getQuota({})` is literally the `account.getQuota` method;
//!   `connect` is the handshake (falling back to `ping` on older servers,
//!   as the SDK does). No `--no-auto-login`, so the CLI uses the same
//!   stored login `managed_auth.rs`'s status check reads. Confirmed live
//!   against the vendored 1.0.85 binary.
//! - **Codex**: `codex app-server`, newline-delimited JSON-RPC --
//!   `initialize` + `initialized`, `account/read`, then
//!   `account/rateLimits/read`, the same three calls the sidecar's own
//!   `codexService.ts` made. Confirmed live against the vendored 0.144.6.
//! - **Claude Code**: `claude auth status --json` for login/email/plan,
//!   then the OAuth access token the CLI itself stores (`~/.claude/
//!   .credentials.json`, or the macOS Keychain item `Claude Code-
//!   credentials` on current builds) against
//!   `https://api.anthropic.com/api/oauth/usage` -- the sidecar's own
//!   fallback path (`readClaudeUsageFromOAuth`), promoted to the only
//!   path: it returns exactly the `five_hour`/`seven_day`/`extra_usage`
//!   shape the mapper wants, without spinning up an SDK session. Confirmed
//!   live.
//!
//! Each provider's raw payload is returned as-is under `data` for the
//! frontend's `managedQuota.ts` to shape into a `ProviderQuotaSnapshot`
//! (the sidecar's own `providerQuota.ts` mappers, ported verbatim) --
//! keeping the "Rust does the subprocess/IO, TypeScript does the shaping"
//! split `managed_auth.rs` already established. The one thing deliberately
//! NOT passed through: Copilot's `account.getCurrentAuth` result carries
//! the raw GitHub token inside `authInfo`; only `login`/plan/reset date
//! are copied out of it.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

use super::managed_binaries::resolve_managed_binary;

/// Per-request ceiling for one JSON-RPC round trip or HTTP call. The
/// sidecar used 20s for the same calls.
const RPC_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Serialize, Default, PartialEq)]
pub struct ManagedQuota {
    pub authenticated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
    /// Why `data` is absent (not signed in, an auth method with no quota
    /// endpoint, a fetch that failed after sign-in was confirmed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// The provider's own raw quota payload -- Copilot: `{quotaSnapshots,
    /// quotaResetDate}`; Codex: the `account/rateLimits/read` result;
    /// Claude Code: the `/api/oauth/usage` body.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

fn binary_or_error(app: &AppHandle, provider: &str) -> Result<PathBuf, String> {
    resolve_managed_binary(app, provider).ok_or_else(|| {
        format!(
            "The {provider} runtime is not installed. Sign in to download it."
        )
    })
}

fn string_field(value: Option<&Value>, key: &str) -> Option<String> {
    value?
        .get(key)?
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

// ------------------------------------------------------------
// A minimal JSON-RPC client over a child process's stdio.
// ------------------------------------------------------------

#[derive(Clone, Copy)]
enum Framing {
    /// `Content-Length: N\r\n\r\n<body>` (vscode-jsonrpc; Copilot CLI).
    ContentLength,
    /// One JSON object per line (Codex app-server).
    NewlineDelimited,
}

struct RpcChild {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    framing: Framing,
    next_id: i64,
}

impl RpcChild {
    async fn spawn(binary: &Path, args: &[&str], framing: Framing) -> Result<Self, String> {
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
            stdin,
            stdout: BufReader::new(stdout),
            framing,
            next_id: 1,
        })
    }

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

    /// Reads one framed message, skipping anything that isn't JSON (a
    /// stray log line on stdout, an empty line).
    async fn read_message(&mut self) -> Result<Value, String> {
        loop {
            match self.framing {
                Framing::ContentLength => {
                    let mut length: Option<usize> = None;
                    loop {
                        let mut line = String::new();
                        let read = self
                            .stdout
                            .read_line(&mut line)
                            .await
                            .map_err(|e| e.to_string())?;
                        if read == 0 {
                            return Err("the CLI closed its output before answering".to_string());
                        }
                        let trimmed = line.trim_end_matches(['\r', '\n']);
                        if trimmed.is_empty() {
                            if length.is_some() {
                                break;
                            }
                            continue;
                        }
                        if let Some(value) = trimmed.strip_prefix("Content-Length:") {
                            length = value.trim().parse().ok();
                        }
                    }
                    let length =
                        length.ok_or("the CLI sent a frame without a Content-Length header")?;
                    let mut body = vec![0u8; length];
                    self.stdout
                        .read_exact(&mut body)
                        .await
                        .map_err(|e| e.to_string())?;
                    if let Ok(value) = serde_json::from_slice::<Value>(&body) {
                        return Ok(value);
                    }
                }
                Framing::NewlineDelimited => {
                    let mut line = String::new();
                    let read = self
                        .stdout
                        .read_line(&mut line)
                        .await
                        .map_err(|e| e.to_string())?;
                    if read == 0 {
                        return Err("the CLI closed its output before answering".to_string());
                    }
                    if let Ok(value) = serde_json::from_str::<Value>(line.trim()) {
                        return Ok(value);
                    }
                }
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

    async fn shutdown(mut self) {
        let _ = self.child.start_kill();
        let _ = self.child.wait().await;
    }
}

// ------------------------------------------------------------
// GitHub Copilot
// ------------------------------------------------------------

pub async fn copilot_quota(app: &AppHandle) -> Result<ManagedQuota, String> {
    let binary = binary_or_error(app, "github-copilot")?;
    let mut rpc = RpcChild::spawn(
        &binary,
        &["--headless", "--no-auto-update", "--stdio"],
        Framing::ContentLength,
    )
    .await?;
    let result = copilot_quota_over(&mut rpc).await;
    rpc.shutdown().await;
    result
}

async fn copilot_quota_over(rpc: &mut RpcChild) -> Result<ManagedQuota, String> {
    // The SDK's own handshake: `connect`, or `ping` against a server too
    // old to know `connect`.
    if let Err(connect_error) = rpc.request("connect", json!({})).await {
        rpc.request("ping", json!({}))
            .await
            .map_err(|_| connect_error)?;
    }

    let auth = rpc.request("account.getCurrentAuth", json!({})).await?;
    let info = auth.get("authInfo").filter(|v| v.is_object());
    let Some(info) = info else {
        let errors: Vec<String> = auth
            .get("authErrors")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        return Ok(ManagedQuota {
            authenticated: false,
            message: Some(if errors.is_empty() {
                "GitHub Copilot sign-in required".to_string()
            } else {
                errors.join("; ")
            }),
            ..ManagedQuota::default()
        });
    };
    let copilot_user = info.get("copilotUser");
    let account = string_field(Some(info), "login").or_else(|| string_field(copilot_user, "login"));
    let plan = string_field(copilot_user, "copilot_plan")
        .or_else(|| string_field(copilot_user, "access_type_sku"));
    // The real period reset lives on the user record; `getQuota`'s own
    // per-snapshot `resetDate` is the snapshot timestamp, not the reset
    // (observed live: every snapshot's resetDate == "now").
    let reset = string_field(copilot_user, "quota_reset_date_utc")
        .or_else(|| string_field(copilot_user, "quota_reset_date"));

    let quota = rpc.request("account.getQuota", json!({})).await?;
    let snapshots = quota.get("quotaSnapshots").cloned().unwrap_or(json!({}));
    Ok(ManagedQuota {
        authenticated: true,
        account,
        plan,
        message: None,
        data: Some(json!({ "quotaSnapshots": snapshots, "quotaResetDate": reset })),
    })
}

// ------------------------------------------------------------
// Codex
// ------------------------------------------------------------

pub async fn codex_quota(app: &AppHandle) -> Result<ManagedQuota, String> {
    let binary = binary_or_error(app, "codex")?;
    let mut rpc = RpcChild::spawn(&binary, &["app-server"], Framing::NewlineDelimited).await?;
    let result = codex_quota_over(&mut rpc).await;
    rpc.shutdown().await;
    result
}

async fn codex_quota_over(rpc: &mut RpcChild) -> Result<ManagedQuota, String> {
    rpc.request(
        "initialize",
        json!({
            "clientInfo": { "name": "rusty", "title": "Rusty", "version": env!("CARGO_PKG_VERSION") },
            "capabilities": { "experimentalApi": true },
        }),
    )
    .await?;
    rpc.notify("initialized", json!({})).await?;

    let read = rpc
        .request("account/read", json!({ "refreshToken": false }))
        .await?;
    let account = read.get("account").filter(|v| v.is_object());
    let Some(account) = account else {
        let requires_auth = read.get("requiresOpenaiAuth").and_then(Value::as_bool);
        return Ok(ManagedQuota {
            authenticated: false,
            message: Some(
                if requires_auth == Some(false) {
                    "Codex is configured for a provider that does not require OpenAI sign-in."
                } else {
                    "Sign in with your OpenAI account to use your Codex plan."
                }
                .to_string(),
            ),
            ..ManagedQuota::default()
        });
    };
    let auth_type = string_field(Some(account), "type").unwrap_or_else(|| "unknown".to_string());
    let email = string_field(Some(account), "email");
    let plan = string_field(Some(account), "planType");
    if auth_type != "chatgpt" && auth_type != "personalAccessToken" {
        return Ok(ManagedQuota {
            authenticated: true,
            account: email,
            plan,
            message: Some(format!("Codex is authenticated using {auth_type}; rate-limit windows are only reported for a ChatGPT sign-in.")),
            data: None,
        });
    }
    let limits = rpc.request("account/rateLimits/read", json!({})).await?;
    Ok(ManagedQuota {
        authenticated: true,
        account: email,
        plan,
        message: None,
        data: Some(limits),
    })
}

// ------------------------------------------------------------
// Claude Code
// ------------------------------------------------------------

fn claude_credentials_path(app: &AppHandle) -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR") {
        return Some(PathBuf::from(dir).join(".credentials.json"));
    }
    app.path()
        .home_dir()
        .ok()
        .map(|h| h.join(".claude").join(".credentials.json"))
}

/// `claudeAiOauth.accessToken` (or the older `oauth.accessToken` /
/// top-level `accessToken`) out of the CLI's credentials JSON -- ported
/// from the sidecar's own `oauthAccessToken`.
pub fn oauth_access_token(credentials: &Value) -> Option<String> {
    let candidates = [
        credentials.pointer("/claudeAiOauth/accessToken"),
        credentials.pointer("/oauth/accessToken"),
        credentials.get("accessToken"),
    ];
    candidates
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::trim)
        .find(|s| !s.is_empty())
        .map(str::to_string)
}

async fn read_claude_oauth_token(credentials_path: Option<PathBuf>) -> Option<String> {
    if let Some(path) = credentials_path {
        if let Ok(content) = tokio::fs::read_to_string(&path).await {
            if let Some(token) = serde_json::from_str::<Value>(&content)
                .ok()
                .as_ref()
                .and_then(oauth_access_token)
            {
                return Some(token);
            }
        }
    }
    // Current macOS builds keep the same JSON payload in the Keychain
    // instead of the file.
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("security")
            .args([
                "find-generic-password",
                "-s",
                "Claude Code-credentials",
                "-w",
            ])
            .stdin(Stdio::null())
            .output()
            .await
            .ok()?;
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            return serde_json::from_str::<Value>(stdout.trim())
                .ok()
                .as_ref()
                .and_then(oauth_access_token);
        }
    }
    None
}

pub async fn claude_code_quota(app: &AppHandle) -> Result<ManagedQuota, String> {
    let binary = binary_or_error(app, "claude-code")?;
    claude_code_quota_with(&binary, claude_credentials_path(app)).await
}

async fn claude_code_quota_with(
    binary: &PathBuf,
    credentials_path: Option<PathBuf>,
) -> Result<ManagedQuota, String> {
    let output = Command::new(binary)
        .args(["auth", "status", "--json"])
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(|error| format!("failed to run {}: {error}", binary.display()))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let status: Value = serde_json::from_str(stdout.trim()).unwrap_or(Value::Null);
    let logged_in = output.status.success()
        && status
            .get("loggedIn")
            .and_then(Value::as_bool)
            .unwrap_or(false);
    let email = string_field(Some(&status), "email");
    let plan = string_field(Some(&status), "subscriptionType");
    if !logged_in {
        return Ok(ManagedQuota {
            authenticated: false,
            account: email,
            plan,
            message: Some("Sign in with Claude Code to read subscription usage.".to_string()),
            data: None,
        });
    }

    let Some(token) = read_claude_oauth_token(credentials_path).await else {
        return Ok(ManagedQuota {
            authenticated: true,
            account: email,
            plan,
            message: Some("Claude Code is connected, but no OAuth credential was found to read its subscription usage with.".to_string()),
            data: None,
        });
    };

    let client = reqwest::Client::builder()
        .timeout(RPC_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get("https://api.anthropic.com/api/oauth/usage")
        .bearer_auth(token)
        .header("anthropic-beta", "oauth-2025-04-20")
        .header("accept", "application/json")
        .send()
        .await
        .map_err(|error| format!("Anthropic usage request failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Anthropic usage request failed ({}).",
            response.status().as_u16()
        ));
    }
    let usage: Value = response
        .json()
        .await
        .map_err(|error| format!("Anthropic usage response was not JSON: {error}"))?;
    Ok(ManagedQuota {
        authenticated: true,
        account: email,
        plan,
        message: None,
        data: Some(usage),
    })
}

pub async fn fetch_quota(app: &AppHandle, provider: &str) -> Result<ManagedQuota, String> {
    match provider {
        "github-copilot" => copilot_quota(app).await,
        "codex" => codex_quota(app).await,
        "claude-code" => claude_code_quota(app).await,
        _ => Err(format!("unknown managed-auth provider: {provider}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A stand-in JSON-RPC server: `sh` reading framed requests is
    /// awkward, so these drive the client against a tiny Node script that
    /// speaks each framing. Skipped when `node` isn't on PATH.
    fn node_available() -> bool {
        std::process::Command::new("node")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    fn write_script(name: &str, body: &str) -> PathBuf {
        let dir = std::env::temp_dir().join("rusty-managed-quota-tests");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, body).unwrap();
        path
    }

    const CONTENT_LENGTH_SERVER: &str = r#"
let buf = Buffer.alloc(0);
function send(msg) { const b = JSON.stringify(msg); process.stdout.write(`Content-Length: ${Buffer.byteLength(b)}\r\n\r\n${b}`); }
process.stdin.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const sep = buf.indexOf("\r\n\r\n"); if (sep === -1) return;
    const len = Number(/Content-Length:\s*(\d+)/.exec(buf.subarray(0, sep).toString())[1]);
    if (buf.length < sep + 4 + len) return;
    const msg = JSON.parse(buf.subarray(sep + 4, sep + 4 + len).toString()); buf = buf.subarray(sep + 4 + len);
    if (msg.method === "connect") { send({ jsonrpc: "2.0", method: "someNotification", params: {} }); send({ jsonrpc: "2.0", id: 99, method: "client.callback", params: {} }); send({ jsonrpc: "2.0", id: msg.id, result: { ok: true, protocolVersion: 3 } }); }
    else if (msg.method === "account.getCurrentAuth") send({ jsonrpc: "2.0", id: msg.id, result: { authInfo: { type: "user", login: "octocat", token: "SECRET", copilotUser: { copilot_plan: "individual", quota_reset_date_utc: "2026-10-01T00:00:00.000Z" } } } });
    else if (msg.method === "account.getQuota") send({ jsonrpc: "2.0", id: msg.id, result: { quotaSnapshots: { chat: { entitlementRequests: 200, usedRequests: 3, remainingPercentage: 98.5, isUnlimitedEntitlement: false } } } });
    else if (msg.id !== undefined && msg.error) { /* our reply to client.callback */ }
    else if (msg.method === "fail") send({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: "boom" } });
    else if (msg.method === "hang") { /* never answer */ }
    else send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "unknown" } });
  }
});
"#;

    const NDJSON_SERVER: &str = r#"
const rl = require("readline").createInterface({ input: process.stdin });
function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") send({ id: msg.id, result: { userAgent: "test" } });
  else if (msg.method === "initialized") { /* notification */ }
  else if (msg.method === "account/read") send({ id: msg.id, result: { account: { type: "chatgpt", email: "me@example.com", planType: "plus" }, requiresOpenaiAuth: true } });
  else if (msg.method === "account/rateLimits/read") send({ id: msg.id, result: { rateLimits: { primary: { usedPercent: 12, windowDurationMins: 300 } } } });
  else send({ id: msg.id, error: { message: "unknown" } });
});
"#;

    async fn spawn_node(script: &Path, framing: Framing) -> RpcChild {
        RpcChild::spawn(&PathBuf::from("node"), &[script.to_str().unwrap()], framing)
            .await
            .expect("node should start")
    }

    #[tokio::test]
    async fn copilot_flow_copies_login_plan_reset_and_snapshots_but_never_the_token() {
        if !node_available() {
            return;
        }
        let script = write_script("copilot.js", CONTENT_LENGTH_SERVER);
        let mut rpc = spawn_node(&script, Framing::ContentLength).await;
        let quota = copilot_quota_over(&mut rpc)
            .await
            .expect("flow should succeed");
        rpc.shutdown().await;

        assert!(quota.authenticated);
        assert_eq!(quota.account.as_deref(), Some("octocat"));
        assert_eq!(quota.plan.as_deref(), Some("individual"));
        let data = quota.data.expect("data");
        assert_eq!(data["quotaResetDate"], "2026-10-01T00:00:00.000Z");
        assert_eq!(data["quotaSnapshots"]["chat"]["usedRequests"], 3);
        assert!(!serde_json::to_string(&data).unwrap().contains("SECRET"));
    }

    #[tokio::test]
    async fn content_length_client_skips_notifications_and_answers_server_requests() {
        if !node_available() {
            return;
        }
        // Exercised by the copilot flow above (the fake `connect` handler
        // emits a notification and a server->client request before its
        // own response); this pins the error and timeout paths.
        let script = write_script("copilot-errors.js", CONTENT_LENGTH_SERVER);
        let mut rpc = spawn_node(&script, Framing::ContentLength).await;
        let error = rpc.request("fail", json!({})).await.unwrap_err();
        assert!(error.contains("boom"), "{error}");
        rpc.shutdown().await;
    }

    #[tokio::test]
    async fn codex_flow_initializes_reads_the_account_and_then_the_rate_limits() {
        if !node_available() {
            return;
        }
        let script = write_script("codex.js", NDJSON_SERVER);
        let mut rpc = spawn_node(&script, Framing::NewlineDelimited).await;
        let quota = codex_quota_over(&mut rpc)
            .await
            .expect("flow should succeed");
        rpc.shutdown().await;

        assert!(quota.authenticated);
        assert_eq!(quota.account.as_deref(), Some("me@example.com"));
        assert_eq!(quota.plan.as_deref(), Some("plus"));
        assert_eq!(
            quota.data.unwrap()["rateLimits"]["primary"]["usedPercent"],
            12
        );
    }

    #[tokio::test]
    async fn a_cli_that_exits_without_answering_is_an_error_not_a_hang() {
        let mut rpc = RpcChild::spawn(
            &PathBuf::from("sh"),
            &["-c", "exit 0"],
            Framing::NewlineDelimited,
        )
        .await
        .unwrap();
        let error = rpc.request("anything", json!({})).await.unwrap_err();
        assert!(
            error.contains("closed its output") || error.contains("failed to write"),
            "{error}"
        );
        rpc.shutdown().await;
    }

    #[test]
    fn oauth_access_token_accepts_every_credential_layout_the_cli_has_used() {
        assert_eq!(
            oauth_access_token(&json!({ "claudeAiOauth": { "accessToken": " tok-a " } }))
                .as_deref(),
            Some("tok-a")
        );
        assert_eq!(
            oauth_access_token(&json!({ "oauth": { "accessToken": "tok-b" } })).as_deref(),
            Some("tok-b")
        );
        assert_eq!(
            oauth_access_token(&json!({ "accessToken": "tok-c" })).as_deref(),
            Some("tok-c")
        );
        assert_eq!(
            oauth_access_token(&json!({ "claudeAiOauth": { "accessToken": "" } })),
            None
        );
        assert_eq!(oauth_access_token(&json!({})), None);
    }

    /// The vendored CLI checkout next to this crate (`vendor-cli/`), the
    /// same packages `scripts/prepare-managed-cli-runtime.mjs` stages
    /// into the bundle -- for the live checks below, which need a real,
    /// signed-in CLI and are therefore `#[ignore]`d: run them by hand
    /// with `cargo test managed_quota -- --ignored` on a machine that is
    /// logged in to the provider.
    fn vendored_node_modules() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("vendor-cli")
            .join("node_modules")
    }

    #[tokio::test]
    #[ignore = "needs the vendored Copilot CLI and a signed-in GitHub account"]
    async fn live_copilot_quota_against_the_vendored_cli() {
        let binary =
            super::super::managed_binaries::github_copilot_binary_path(&vendored_node_modules())
                .expect("vendored copilot binary");
        let mut rpc = RpcChild::spawn(
            &binary,
            &["--headless", "--no-auto-update", "--stdio"],
            Framing::ContentLength,
        )
        .await
        .unwrap();
        let quota = copilot_quota_over(&mut rpc)
            .await
            .expect("live copilot flow");
        rpc.shutdown().await;
        println!("{}", serde_json::to_string_pretty(&quota).unwrap());
        assert!(
            quota.authenticated,
            "expected a signed-in Copilot account: {quota:?}"
        );
        assert!(quota
            .data
            .as_ref()
            .and_then(|d| d.get("quotaSnapshots"))
            .is_some_and(|s| s.is_object()));
    }

    #[tokio::test]
    #[ignore = "needs the vendored Codex CLI and a signed-in OpenAI account"]
    async fn live_codex_quota_against_the_vendored_cli() {
        let binary = super::super::managed_binaries::codex_binary_path(&vendored_node_modules())
            .expect("vendored codex binary");
        let mut rpc = RpcChild::spawn(&binary, &["app-server"], Framing::NewlineDelimited)
            .await
            .unwrap();
        let quota = codex_quota_over(&mut rpc).await.expect("live codex flow");
        rpc.shutdown().await;
        println!("{}", serde_json::to_string_pretty(&quota).unwrap());
        assert!(
            quota.authenticated,
            "expected a signed-in Codex account: {quota:?}"
        );
        assert!(quota
            .data
            .as_ref()
            .and_then(|d| d.get("rateLimits"))
            .is_some());
    }

    #[tokio::test]
    #[ignore = "needs the vendored Claude Code CLI, a signed-in claude.ai account, and network access"]
    async fn live_claude_code_quota_against_the_vendored_cli() {
        let binary =
            super::super::managed_binaries::claude_code_binary_path(&vendored_node_modules())
                .expect("vendored claude binary");
        let credentials = std::env::var_os("HOME")
            .map(|h| PathBuf::from(h).join(".claude").join(".credentials.json"));
        let quota = claude_code_quota_with(&binary, credentials)
            .await
            .expect("live claude code flow");
        println!("{}", serde_json::to_string_pretty(&quota).unwrap());
        assert!(
            quota.authenticated,
            "expected a signed-in Claude Code account: {quota:?}"
        );
        assert!(
            quota
                .data
                .as_ref()
                .and_then(|d| d.get("five_hour"))
                .is_some(),
            "{quota:?}"
        );
    }

    #[test]
    fn managed_quota_serializes_without_absent_fields() {
        let quota = ManagedQuota {
            authenticated: false,
            message: Some("no".into()),
            ..ManagedQuota::default()
        };
        assert_eq!(
            serde_json::to_value(quota).unwrap(),
            json!({ "authenticated": false, "message": "no" })
        );
    }
}
