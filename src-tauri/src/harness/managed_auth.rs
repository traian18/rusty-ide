//! Login/status/logout for the two managed-auth providers (Codex, GitHub
//! Copilot), driven by shelling out to each CLI's own plain
//! subcommands -- the Tauri command surface `commands.rs` never had before
//! this (`harness_list_providers`/`harness_list_models` were the only
//! provider-facing commands; see HARNESS_CONTRACT_PLAN.md's Milestone B2).
//!
//! `harness_engine::Harness::begin_auth`/`provider_health` (the scaffolding
//! rusty-core's own reference embedders use -- `apps/harness/src/
//! controller.rs`'s `auth_instruction()`) exist but don't fit `rusty` as-is:
//! `provider_health`'s readiness check calls `find_executable`, which
//! searches `$PATH`, not the app-local runtime path these binaries actually
//! live at (`managed_binaries.rs`); and `list_credential_profiles` hardcodes
//! `CredentialState::ManagedExternally` for all three CLI-managed providers
//! regardless of whether the user is actually logged in, so `ready` from
//! those functions would be misleading here. This module does its own,
//! provider-specific check by shelling out to each CLI directly instead.
//!
//! Exact commands per provider, confirmed against the vendored CLI's own
//! `--help` output (not guessed) and, where noted, already proven by the
//! sidecar's own working code (`agent-sidecar/src/services/
//! {codexService,copilotService}.ts`):
//! - Codex: `login` (browser flow -- `--device-auth` exists but its exact
//!   output is unverified without a live login, so left unused), `login
//!   status` (plain text, no `--json` flag), `logout`.
//! - GitHub Copilot: `login --host <host>` (device-code flow, output
//!   scraped the same way `copilotService.ts`'s own `parseCopilotLoginOutput`
//!   already does, ported verbatim below). Copilot's CLI has **no plain
//!   status or logout subcommand at all** (confirmed: its top-level `--help`
//!   lists only `login` among auth-related commands) -- the sidecar's own
//!   status/logout go through the `@github/copilot-sdk`'s RPC client
//!   instead, which this pass deliberately doesn't reimplement (see the
//!   plan doc's own scope notes). `status`/`logout` for Copilot are a
//!   documented v1 gap: `status` reports `authenticated: None` ("unknown"),
//!   `logout` returns an explanatory error rather than silently no-op'ing.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use regex::Regex;
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use super::managed_binaries::{ensure_managed_binary, is_managed_provider, resolve_managed_binary};

#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
pub struct LoginState {
    /// `None` when this provider has no reliable plain-CLI way to check
    /// or a check hasn't completed yet.
    pub authenticated: Option<bool>,
    pub message: String,
    pub verification_uri: Option<String>,
    pub user_code: Option<String>,
    pub in_progress: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
}

/// Per-provider in-flight/last-known login state, held for the app's
/// lifetime. `managed_auth_login_status` polls this -- mirrors the existing
/// sidecar-backed `useManagedProviderStatus.ts` polling pattern on the
/// frontend, so no new frontend architecture is needed for this either.
#[derive(Default)]
pub struct ManagedAuthState {
    logins: Mutex<HashMap<String, LoginState>>,
    /// The in-flight `start_login` task per provider, so a second attempt
    /// can abort the first instead of being silently ignored. Aborting the
    /// task drops its `Child`, and `kill_on_drop(true)` turns that into a
    /// real kill -- otherwise a login CLI still waiting on a browser
    /// callback nobody is going to complete keeps `in_progress: true`
    /// forever, which the UI renders as a permanently disabled
    /// "Signing in..." button (clicking it does nothing at all).
    tasks: Mutex<HashMap<String, (u64, tauri::async_runtime::JoinHandle<()>)>>,
    /// Senders for passing interactive input to the login child process's
    /// stdin.
    inputs: Mutex<HashMap<String, (u64, tokio::sync::mpsc::Sender<String>)>>,
    /// Monotonic attempt id, so a finishing task only clears its own
    /// registration -- an attempt that completes naturally just as a new
    /// one supersedes it must not unregister the new one.
    next_attempt: Mutex<u64>,
}

impl ManagedAuthState {
    pub fn new() -> Self {
        Self::default()
    }

    fn set(&self, provider: &str, state: LoginState) {
        self.logins
            .lock()
            .expect("managed auth state mutex poisoned")
            .insert(provider.to_string(), state);
    }

    fn next_attempt_id(&self) -> u64 {
        let mut next = self
            .next_attempt
            .lock()
            .expect("managed auth attempt mutex poisoned");
        *next += 1;
        *next
    }

    /// Records this attempt's task, aborting whatever attempt the provider
    /// had in flight (aborting an already-finished task is a no-op, and a
    /// finished one has normally unregistered itself already).
    fn replace_task(
        &self,
        provider: &str,
        attempt: u64,
        task: tauri::async_runtime::JoinHandle<()>,
    ) {
        let previous = self
            .tasks
            .lock()
            .expect("managed auth task mutex poisoned")
            .insert(provider.to_string(), (attempt, task));
        if let Some((_, handle)) = previous {
            handle.abort();
        }
    }

    fn replace_input(
        &self,
        provider: &str,
        attempt: u64,
        sender: tokio::sync::mpsc::Sender<String>,
    ) {
        self.inputs
            .lock()
            .expect("managed auth input mutex poisoned")
            .insert(provider.to_string(), (attempt, sender));
    }

    fn clear_task(&self, provider: &str, attempt: u64) {
        let mut tasks = self.tasks.lock().expect("managed auth task mutex poisoned");
        if tasks.get(provider).is_some_and(|(id, _)| *id == attempt) {
            tasks.remove(provider);
        }
        let mut inputs = self
            .inputs
            .lock()
            .expect("managed auth input mutex poisoned");
        if inputs.get(provider).is_some_and(|(id, _)| *id == attempt) {
            inputs.remove(provider);
        }
    }

    pub fn cancel_login(&self, provider: &str) {
        let mut tasks = self.tasks.lock().expect("managed auth task mutex poisoned");
        if let Some((_, handle)) = tasks.remove(provider) {
            handle.abort();
        }
        let mut inputs = self
            .inputs
            .lock()
            .expect("managed auth input mutex poisoned");
        inputs.remove(provider);
        self.set(
            provider,
            LoginState {
                authenticated: Some(false),
                message: "Sign-in cancelled.".to_string(),
                ..LoginState::default()
            },
        );
    }

    pub async fn send_input(&self, provider: &str, input: String) -> Result<(), String> {
        let sender = {
            let inputs = self
                .inputs
                .lock()
                .expect("managed auth input mutex poisoned");
            inputs.get(provider).map(|(_, tx)| tx.clone())
        };
        match sender {
            Some(tx) => tx
                .send(input)
                .await
                .map_err(|e| format!("Failed to send input to {provider} login process: {e}")),
            None => Err(format!(
                "No active login process waiting for input for {provider}"
            )),
        }
    }

    #[cfg(test)]
    fn has_task(&self, provider: &str) -> bool {
        self.tasks
            .lock()
            .expect("managed auth task mutex poisoned")
            .contains_key(provider)
    }

    pub fn get(&self, provider: &str) -> LoginState {
        self.logins
            .lock()
            .expect("managed auth state mutex poisoned")
            .get(provider)
            .cloned()
            .unwrap_or_default()
    }
}

fn binary_or_error(app: &AppHandle, provider: &str) -> Result<PathBuf, String> {
    resolve_managed_binary(app, provider)
        .ok_or_else(|| format!("The {provider} runtime is not installed. Sign in to download it."))
}

async fn run_to_completion(binary: &PathBuf, args: &[&str]) -> Result<(bool, String), String> {
    let output = Command::new(binary)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(|error| format!("failed to run {}: {error}", binary.display()))?;
    let mut combined = String::from_utf8_lossy(&output.stdout).into_owned();
    combined.push_str(&String::from_utf8_lossy(&output.stderr));
    Ok((output.status.success(), combined))
}

fn copilot_config_path(app: &AppHandle) -> Option<PathBuf> {
    if let Some(home) = std::env::var_os("COPILOT_HOME") {
        return Some(PathBuf::from(home).join("config.json"));
    }
    app.path()
        .home_dir()
        .ok()
        .map(|h| h.join(".copilot").join("config.json"))
}

pub fn parse_copilot_config(content: &str) -> (Option<String>, bool) {
    let clean_json: String = content
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n");

    let val: serde_json::Value = match serde_json::from_str(&clean_json) {
        Ok(v) => v,
        Err(_) => return (None, false),
    };

    let login = val
        .get("lastLoggedInUser")
        .and_then(|u| u.get("login"))
        .and_then(|l| l.as_str())
        .filter(|l| !l.is_empty())
        .or_else(|| {
            val.get("loggedInUsers")
                .and_then(|u| u.as_array())
                .and_then(|arr| arr.first())
                .and_then(|u| u.get("login"))
                .and_then(|l| l.as_str())
                .filter(|l| !l.is_empty())
        })
        .map(|s| s.to_string());

    let authenticated = login.is_some();
    (login, authenticated)
}

async fn check_copilot_status(app: &AppHandle) -> LoginState {
    if let Some(path) = copilot_config_path(app) {
        if path.is_file() {
            if let Ok(content) = std::fs::read_to_string(&path) {
                let (login, authenticated) = parse_copilot_config(&content);
                if authenticated {
                    let user = login.unwrap_or_default();
                    return LoginState {
                        authenticated: Some(true),
                        message: format!("Signed in as {user}"),
                        account: Some(user),
                        ..LoginState::default()
                    };
                }
            }
        }
    }

    // Config file didn't report authentication (credentials may be in the Keychain
    // or GitHub CLI). Probe using copilot_quota which queries the CLI's stdio RPC.
    match super::managed_quota::copilot_quota(app).await {
        Ok(quota) if quota.authenticated => {
            let user = quota.account.unwrap_or_default();
            LoginState {
                authenticated: Some(true),
                message: if user.is_empty() {
                    "Signed in to GitHub Copilot".to_string()
                } else {
                    format!("Signed in as {user}")
                },
                account: if user.is_empty() { None } else { Some(user) },
                ..LoginState::default()
            }
        }
        Ok(quota) => LoginState {
            authenticated: Some(false),
            message: quota
                .message
                .unwrap_or_else(|| "GitHub Copilot sign-in required".to_string()),
            ..LoginState::default()
        },
        Err(e) => LoginState {
            authenticated: Some(false),
            message: format!("GitHub Copilot sign-in required ({e})"),
            ..LoginState::default()
        },
    }
}

fn clear_copilot_auth(app: &AppHandle) -> Result<(), String> {
    let path = copilot_config_path(app).ok_or("Could not locate Copilot config directory")?;
    if !path.is_file() {
        return Ok(());
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let clean_json: String = content
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n");
    let mut val: serde_json::Value =
        serde_json::from_str(&clean_json).unwrap_or(serde_json::json!({}));
    if let Some(obj) = val.as_object_mut() {
        obj.remove("lastLoggedInUser");
        obj.insert("loggedInUsers".to_string(), serde_json::json!([]));
    }
    let new_content = serde_json::to_string_pretty(&val).map_err(|e| e.to_string())?;
    std::fs::write(&path, new_content).map_err(|e| e.to_string())?;
    Ok(())
}

/// On-demand "is this provider currently authenticated" check.
pub async fn check_status(
    app: &AppHandle,
    state: &ManagedAuthState,
    provider: &str,
) -> Result<LoginState, String> {
    let in_flight = state.get(provider);
    if in_flight.in_progress {
        return Ok(in_flight);
    }

    if is_managed_provider(provider) && resolve_managed_binary(app, provider).is_none() {
        // Preserve download errors/cancellation so polling does not hide
        // the reason sign-in failed before the user can read it.
        if !in_flight.message.is_empty() {
            return Ok(in_flight);
        }
        return Ok(LoginState {
            authenticated: Some(false),
            message: "Sign in to download this integration’s runtime. It will be reused on future launches.".into(),
            ..LoginState::default()
        });
    }

    match provider {
        "codex" => {
            let binary = binary_or_error(app, provider)?;
            let (success, message) = run_to_completion(&binary, &["login", "status"]).await?;
            Ok(LoginState {
                authenticated: Some(success),
                message,
                verification_uri: None,
                user_code: None,
                in_progress: false,
                account: None,
            })
        }
        "github-copilot" => {
            let mut copilot_state = check_copilot_status(app).await;
            if in_flight.authenticated == Some(true) && copilot_state.authenticated != Some(true) {
                copilot_state = in_flight;
            }
            Ok(copilot_state)
        }
        _ => Err(format!("unknown managed-auth provider: {provider}")),
    }
}

/// Copilot's own device-code login output, scraped the same way
/// `agent-sidecar/src/services/copilotService.ts`'s `parseCopilotLoginOutput`
/// already does -- ported verbatim (same three regexes, same precedence).
fn parse_copilot_login_output(buffer: &str) -> (Option<String>, Option<String>, bool) {
    let primary = Regex::new(r"(?i)(?:visit|open)\s+(https://\S+?)\s+(?:and\s+)?(?:then\s+)?enter\s+(?:the\s+)?code\s+([A-Z0-9]{4}(?:-[A-Z0-9]{4})+)")
        .expect("static regex");
    if let Some(captures) = primary.captures(buffer) {
        let uri = captures.get(1).map(|m| m.as_str().to_string());
        let code = captures.get(2).map(|m| m.as_str().to_string());
        let done = Regex::new(r"(?i)Signed in successfully as")
            .expect("static regex")
            .is_match(buffer);
        return (uri, code, done);
    }
    let uri_fallback =
        Regex::new(r"(?i)https://github\.com/login/device\b\S*").expect("static regex");
    let code_fallback = Regex::new(r"(?i)\b[A-Z0-9]{4}-[A-Z0-9]{4}\b").expect("static regex");
    let uri = uri_fallback.find(buffer).map(|m| m.as_str().to_string());
    let code = code_fallback.find(buffer).map(|m| m.as_str().to_string());
    let done = Regex::new(r"(?i)Signed in successfully as")
        .expect("static regex")
        .is_match(buffer);
    (uri, code, done)
}

/// What a provider's login output says about the attempt so far:
/// `(verification_uri, user_code, finished_successfully)`. Only Copilot,
/// whose CLI actually prints something actionable, is parsed;
/// Codex's `login` output has not been captured against a real attempt, so
/// it deliberately reports nothing rather than guessing at a format.
fn parse_login_output(
    provider: &str,
    buffer: &str,
) -> Option<(Option<String>, Option<String>, bool)> {
    match provider {
        "github-copilot" => {
            let (uri, code, done) = parse_copilot_login_output(buffer);
            Some((uri, code, done))
        }
        _ => None,
    }
}

/// What to tell the user when a login CLI exits without printing a single
/// line. That is never normal -- every one of these CLIs announces itself
/// before doing anything -- and the cause that actually happened here was
/// a **corrupt staged binary**: a resource copy with a hole of zeros in
/// the middle, whose code signature no longer matched, so macOS SIGKILLed
/// it the instant it was exec'd. Silent failure made that look like the
/// sign-in button doing nothing at all, so this says the quiet part out
/// loud, with the path and the check that diagnoses it.
fn silent_exit_message(
    provider: &str,
    binary: &Path,
    status: Option<std::process::ExitStatus>,
) -> String {
    let detail = match status {
        Some(status) => format!("exited immediately ({status})"),
        None => "could not be waited on".to_string(),
    };
    format!(
        "The {provider} CLI {detail} without printing anything, so no sign-in could start. \
         Its installed binary may be corrupt or improperly signed -- check it with \
         `codesign --verify {}` and remove this runtime’s version directory, then sign in to download it again.",
        binary.display()
    )
}

fn login_args(provider: &str) -> Result<Vec<&'static str>, String> {
    match provider {
        "codex" => Ok(vec!["login"]),
        "github-copilot" => Ok(vec![
            "login",
            "--device-code",
            "--host",
            "https://github.com",
        ]),
        _ => Err(format!("unknown managed-auth provider: {provider}")),
    }
}

async fn drain_lines(reader: impl tokio::io::AsyncRead + Unpin) -> String {
    let mut combined = String::new();
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        combined.push_str(&line);
        combined.push('\n');
    }
    combined
}

/// Starts a login attempt in the background: spawns `<binary> login
/// [args]`, waits for it to finish while capturing its combined stdout/
/// stderr (parsing out whatever the provider's CLI reports about the
/// attempt -- a device code for Copilot),
/// and marks `in_progress: false` once done, following up with
/// `check_status` so `authenticated` reflects reality rather than just
/// "the process exited 0." Returns immediately -- `managed_auth_login_status`
/// is how the frontend observes progress (matches the existing
/// sidecar-backed Copilot/Codex login cards' own polling UX).
/// `state` is an `Arc` clone the caller already holds (from
/// `HarnessState`), so this background task outlives the Tauri command that
/// started it without needing a `'static` reference into `HarnessState`
/// itself.
///
/// Clicking sign-in again while an attempt is still running **supersedes**
/// it (the old CLI process is killed) rather than being ignored: a login
/// CLI blocks until its browser callback arrives, so an attempt the user
/// abandoned would otherwise hold `in_progress: true` for the rest of the
/// session, and the UI disables its own sign-in button while a login is in
/// progress -- leaving a button that does nothing, with no browser ever
/// opening again. `LOGIN_TIMEOUT` is the same protection against an
/// attempt nobody ever clicks again.
const LOGIN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10 * 60);

pub fn start_login(
    app: AppHandle,
    state: Arc<ManagedAuthState>,
    provider: String,
) -> Result<(), String> {
    let args = login_args(&provider)?;

    state.set(
        &provider,
        LoginState {
            in_progress: true,
            message: if resolve_managed_binary(&app, &provider).is_some() {
                "Starting login...".into()
            } else {
                "Downloading and installing the integration runtime. This may take a few minutes..."
                    .into()
            },
            ..LoginState::default()
        },
    );

    let attempt = state.next_attempt_id();
    let (input_tx, input_rx) = tokio::sync::mpsc::channel::<String>(16);
    state.replace_input(&provider, attempt, input_tx);

    let task_state = state.clone();
    let task_provider = provider.clone();
    let task = tauri::async_runtime::spawn(async move {
        let state = task_state;
        let provider = task_provider;
        let binary = match ensure_managed_binary(&app, &provider).await {
            Ok(binary) => binary,
            Err(message) => {
                state.set(
                    &provider,
                    LoginState {
                        authenticated: Some(false),
                        message,
                        ..LoginState::default()
                    },
                );
                state.clear_task(&provider, attempt);
                return;
            }
        };
        state.set(
            &provider,
            LoginState {
                in_progress: true,
                message: "Starting login...".into(),
                ..LoginState::default()
            },
        );
        let mut command = Command::new(&binary);
        command
            .args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                state.set(
                    &provider,
                    LoginState {
                        authenticated: Some(false),
                        message: format!("failed to start {}: {error}", binary.display()),
                        ..LoginState::default()
                    },
                );
                state.clear_task(&provider, attempt);
                return;
            }
        };
        let mut stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let mut stdout_lines = stdout.map(|s| BufReader::new(s).lines());
        let mut stderr_lines = stderr.map(|s| BufReader::new(s).lines());
        let mut input_rx_opt = Some(input_rx);

        let mut buffer = String::new();
        let publish = |buffer: &str| {
            if let Some((uri, code, done)) = parse_login_output(&provider, buffer) {
                state.set(
                    &provider,
                    LoginState {
                        authenticated: if done { Some(true) } else { None },
                        message: buffer.trim().to_string(),
                        verification_uri: uri,
                        user_code: code,
                        in_progress: !done,
                        account: None,
                    },
                );
            }
        };

        let mut exit_status: Option<std::process::ExitStatus> = None;
        let drive = async {
            loop {
                tokio::select! {
                    maybe_input = async {
                        match &mut input_rx_opt {
                            Some(rx) => rx.recv().await,
                            None => std::future::pending().await,
                        }
                    } => {
                        match maybe_input {
                            Some(line) => {
                                if let Some(ref mut sin) = stdin {
                                    use tokio::io::AsyncWriteExt;
                                    let to_write = format!("{}\n", line.trim());
                                    println!("Rust [managed_auth] writing input to {provider} stdin");
                                    if let Err(e) = sin.write_all(to_write.as_bytes()).await {
                                        println!("Rust [managed_auth] failed to write to {provider} stdin: {e}");
                                    }
                                    let _ = sin.flush().await;
                                }
                            }
                            None => {
                                input_rx_opt = None;
                            }
                        }
                    }
                    line = async {
                        match &mut stdout_lines {
                            Some(reader) => reader.next_line().await,
                            None => std::future::pending().await,
                        }
                    } => {
                        match line {
                            Ok(Some(l)) => {
                                println!("Rust [managed_auth] {provider} login: {l}");
                                buffer.push_str(&l);
                                buffer.push('\n');
                                publish(&buffer);
                            }
                            _ => {
                                stdout_lines = None;
                            }
                        }
                    }
                    line = async {
                        match &mut stderr_lines {
                            Some(reader) => reader.next_line().await,
                            None => std::future::pending().await,
                        }
                    } => {
                        match line {
                            Ok(Some(l)) => {
                                println!("Rust [managed_auth] {provider} login: {l}");
                                buffer.push_str(&l);
                                buffer.push('\n');
                                publish(&buffer);
                            }
                            _ => {
                                stderr_lines = None;
                            }
                        }
                    }
                    status = child.wait() => {
                        exit_status = status.ok();
                        break;
                    }
                }
                if stdout_lines.is_none() && stderr_lines.is_none() {
                    exit_status = child.wait().await.ok();
                    break;
                }
            }
        };

        // A login CLI waits on its browser callback indefinitely; without
        // this, an abandoned attempt pins `in_progress` for the session.
        // The dropped `child` is killed by `kill_on_drop`.
        let timed_out = tokio::time::timeout(LOGIN_TIMEOUT, drive).await.is_err();
        if timed_out {
            state.set(&provider, LoginState {
                authenticated: Some(false),
                message: format!(
                    "The {provider} sign-in was not completed within {} minutes. Start it again to retry.",
                    LOGIN_TIMEOUT.as_secs() / 60
                ),
                ..LoginState::default()
            });
            state.clear_task(&provider, attempt);
            return;
        }

        if buffer.trim().is_empty() {
            let message = silent_exit_message(&provider, &binary, exit_status);
            println!("Rust [managed_auth] {message}");
            state.set(
                &provider,
                LoginState {
                    authenticated: Some(false),
                    message,
                    ..LoginState::default()
                },
            );
            state.clear_task(&provider, attempt);
            return;
        }

        // `check_status` early-returns the in-flight state while a login is
        // in progress, so leaving `in_progress` set here would make this a
        // read of our own "Starting login..." placeholder rather than a real
        // status check -- which is exactly what turned a failed attempt into
        // a content-free UI flicker instead of an error.
        state.set(
            &provider,
            LoginState {
                message: buffer.trim().to_string(),
                in_progress: false,
                ..LoginState::default()
            },
        );

        match check_status(&app, &state, &provider).await {
            Ok(mut final_state) => {
                if let Some((uri, code, done)) = parse_login_output(&provider, &buffer) {
                    if final_state.verification_uri.is_none() {
                        final_state.verification_uri = uri;
                    }
                    if final_state.user_code.is_none() {
                        final_state.user_code = code;
                    }
                    if done {
                        final_state.authenticated = Some(true);
                    }
                    if final_state.message.trim().is_empty() {
                        final_state.message = buffer.trim().to_string();
                    }
                }
                final_state.in_progress = false;
                state.set(&provider, final_state);
            }
            Err(error) => {
                state.set(
                    &provider,
                    LoginState {
                        authenticated: None,
                        message: error,
                        in_progress: false,
                        ..LoginState::default()
                    },
                );
            }
        }
        state.clear_task(&provider, attempt);
    });

    state.replace_task(&provider, attempt, task);
    Ok(())
}

fn logout_args(provider: &str) -> Result<Vec<&'static str>, String> {
    match provider {
        "codex" => Ok(vec!["logout"]),
        "github-copilot" => Err(
            "GitHub Copilot's CLI has no plain logout subcommand -- sign out via the credential your OS keychain (or ~/.copilot/) stores, the same store the existing sidecar-based logout manages.".to_string(),
        ),
        _ => Err(format!("unknown managed-auth provider: {provider}")),
    }
}

pub async fn logout(
    app: &AppHandle,
    state: &ManagedAuthState,
    provider: &str,
) -> Result<(), String> {
    if provider == "github-copilot" {
        clear_copilot_auth(app)?;
        state.set(provider, LoginState::default());
        return Ok(());
    }
    let binary = binary_or_error(app, provider)?;
    let args = logout_args(provider)?;
    let (_success, _output) = run_to_completion(&binary, &args).await?;
    state.set(provider, LoginState::default());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_copilots_primary_device_code_pattern() {
        let output = "Please visit https://github.com/login/device and enter the code ABCD-1234 to continue.";
        let (uri, code, done) = parse_copilot_login_output(output);
        assert_eq!(uri.as_deref(), Some("https://github.com/login/device"));
        assert_eq!(code.as_deref(), Some("ABCD-1234"));
        assert!(!done);
    }

    #[test]
    fn detects_successful_copilot_sign_in() {
        let output = "Signed in successfully as octocat";
        let (_, _, done) = parse_copilot_login_output(output);
        assert!(done);
    }

    #[test]
    fn falls_back_to_the_bare_device_uri_and_code_when_the_sentence_pattern_does_not_match() {
        let output = "Go here: https://github.com/login/device?extra=1\nyour code is XYZA-9876";
        let (uri, code, _) = parse_copilot_login_output(output);
        assert_eq!(
            uri.as_deref(),
            Some("https://github.com/login/device?extra=1")
        );
        assert_eq!(code.as_deref(), Some("XYZA-9876"));
    }

    #[test]
    fn reports_no_match_for_unrelated_output() {
        let (uri, code, done) = parse_copilot_login_output("Checking for updates...\n");
        assert_eq!(uri, None);
        assert_eq!(code, None);
        assert!(!done);
    }

    #[test]
    fn managed_auth_state_defaults_to_an_empty_unauthenticated_entry() {
        let state = ManagedAuthState::new();
        let login = state.get("codex");
        assert_eq!(login.authenticated, None);
        assert!(!login.in_progress);
    }

    #[test]
    fn managed_auth_state_round_trips_a_set_value() {
        let state = ManagedAuthState::new();
        state.set(
            "codex",
            LoginState {
                authenticated: Some(true),
                message: "Ready".to_string(),
                ..LoginState::default()
            },
        );
        let login = state.get("codex");
        assert_eq!(login.authenticated, Some(true));
        assert_eq!(login.message, "Ready");
    }

    #[test]
    fn login_args_are_defined_for_every_managed_provider() {
        assert_eq!(login_args("codex").unwrap(), vec!["login"]);
        assert_eq!(
            login_args("github-copilot").unwrap(),
            vec!["login", "--device-code", "--host", "https://github.com"]
        );
        assert!(login_args("unknown").is_err());
    }

    #[test]
    fn copilot_has_no_plain_logout_subcommand() {
        assert!(logout_args("github-copilot").is_err());
        assert_eq!(logout_args("codex").unwrap(), vec!["logout"]);
    }

    #[test]
    fn login_output_is_parsed_for_copilot_but_not_guessed_at_for_codex() {
        assert!(parse_login_output(
            "github-copilot",
            "visit https://github.com/login/device and enter code ABCD-1234"
        )
        .is_some());
        assert!(parse_login_output("codex", "anything at all").is_none());
    }

    #[tokio::test]
    async fn a_second_login_attempt_supersedes_the_first_instead_of_being_ignored() {
        let state = ManagedAuthState::new();
        let first_ran = Arc::new(Mutex::new(false));
        let flag = first_ran.clone();
        let first_attempt = state.next_attempt_id();
        let first = tauri::async_runtime::spawn(async move {
            // Stands in for a login CLI still waiting on a browser
            // callback that never arrives.
            tokio::time::sleep(std::time::Duration::from_secs(300)).await;
            *flag.lock().unwrap() = true;
        });
        state.replace_task("codex", first_attempt, first);
        assert!(state.has_task("codex"));

        let second_attempt = state.next_attempt_id();
        let second = tauri::async_runtime::spawn(async {});
        state.replace_task("codex", second_attempt, second);

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(
            !*first_ran.lock().unwrap(),
            "the abandoned attempt must have been aborted, not left running"
        );

        // The superseded attempt's own cleanup must not unregister the
        // one that replaced it.
        state.clear_task("codex", first_attempt);
        assert!(
            state.has_task("codex"),
            "the live attempt is still registered"
        );
        state.clear_task("codex", second_attempt);
        assert!(!state.has_task("codex"));
    }

    #[test]
    fn a_cli_that_dies_without_output_names_the_binary_and_the_check_that_finds_it() {
        // The real failure: a staged CLI binary had a hole of zeros
        // in the middle from an interrupted resource copy, so its
        // signature no longer matched and macOS killed it on exec --
        // exit 137, no output, and the sign-in button looked inert.
        let message = silent_exit_message(
            "github-copilot",
            Path::new("/Apps/rusty.app/Contents/Resources/managed-cli/copilot"),
            None,
        );
        assert!(message.contains("github-copilot"), "{message}");
        assert!(
            message.contains("/Apps/rusty.app/Contents/Resources/managed-cli/copilot"),
            "{message}"
        );
        assert!(message.contains("codesign --verify"), "{message}");
        assert!(message.contains("download it again"), "{message}");
    }

    #[tokio::test]
    async fn a_killed_cli_reports_its_signal_rather_than_looking_like_nothing_happened() {
        let status = Command::new("sh")
            .args(["-c", "kill -9 $$"])
            .status()
            .await
            .expect("sh should run");
        let message = silent_exit_message("codex", Path::new("/tmp/codex"), Some(status));
        assert!(message.contains("exited immediately"), "{message}");
        assert!(
            message.contains("signal: 9"),
            "the signal must be visible, not swallowed: {message}"
        );
    }

    #[test]
    fn parses_copilot_config_with_last_logged_in_user() {
        let content = r#"
// User settings belong in settings.json.
// This file is managed automatically.
{
  "firstLaunchAt": "2026-07-15T20:58:15.503Z",
  "lastLoggedInUser": {
    "host": "https://github.com",
    "login": "octocat"
  },
  "loggedInUsers": [
    {
      "host": "https://github.com",
      "login": "octocat"
    }
  ]
}
"#;
        let (login, authenticated) = parse_copilot_config(content);
        assert_eq!(login.as_deref(), Some("octocat"));
        assert!(authenticated);
    }

    #[test]
    fn parses_copilot_config_when_unauthenticated() {
        let content = r#"
{
  "firstLaunchAt": "2026-07-15T20:58:15.503Z",
  "lastLoggedInUser": null,
  "loggedInUsers": []
}
"#;
        let (login, authenticated) = parse_copilot_config(content);
        assert_eq!(login, None);
        assert!(!authenticated);
    }

    #[tokio::test]
    async fn managed_auth_state_send_input_fails_when_no_active_login() {
        let state = ManagedAuthState::new();
        let result = state.send_input("codex", "test-input".to_string()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No active login process"));
    }

    #[tokio::test]
    async fn managed_auth_state_send_input_routes_to_channel() {
        let state = ManagedAuthState::new();
        let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(16);
        state.replace_input("codex", 1, tx);

        let send_res = state.send_input("codex", "my-input".to_string()).await;
        assert!(send_res.is_ok());

        let received = rx.recv().await;
        assert_eq!(received.as_deref(), Some("my-input"));
    }

    #[test]
    fn managed_auth_state_cancel_login_cleans_up_and_resets_state() {
        let state = ManagedAuthState::new();
        state.set(
            "codex",
            LoginState {
                in_progress: true,
                message: "Signing in...".to_string(),
                ..LoginState::default()
            },
        );
        let (tx, _rx) = tokio::sync::mpsc::channel::<String>(16);
        state.replace_input("codex", 1, tx);

        state.cancel_login("codex");
        let login = state.get("codex");
        assert!(!login.in_progress);
        assert_eq!(login.authenticated, Some(false));
        assert_eq!(login.message, "Sign-in cancelled.");
    }
}
