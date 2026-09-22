//! One-shot command execution for the model-facing `run_command` tools:
//! `test_build`'s own (HARNESS_CONTRACT_PLAN.md Milestone C -- the
//! workspace's configured build command plus the fix-attempt model's
//! diagnostic commands) and `agent_chat`'s permission-gated one
//! (src/harness/core/definitions/runCommandTool.ts). Deliberately NOT the
//! interactive terminal (`create_terminal_session`/`write_to_terminal`,
//! PTY-backed, for a human typing into a shell) -- this is
//! request/response: spawn, wait for exit (or the timeout, or a cancel),
//! return the captured output, once.
//!
//! No permission gate here: this is the executor, and the gate is the
//! caller's. `test_build` deliberately has none (matching the sidecar's
//! own `testBuild.ts` -- its trust boundary is "the user explicitly
//! started a build+fix run for this workspace with a command they
//! configured", not per-command; gating every diagnostic command during
//! an unattended multi-attempt fix loop would defeat the point of it being
//! unattended). `agent_chat`'s tool asks the user through the IDE's
//! command-permission dialog before it ever calls in here.
//!
//! Cancellation: a caller that passes an `execution_id` can later invoke
//! `cancel_shell_command` with it (the IDE does so from the run's own
//! AbortSignal), which kills the process instead of leaving it to run out
//! its timeout after the user pressed Stop. On Unix the child is put in
//! its own process group and the whole group is killed, so a build tool's
//! own children (`npm test` -> `node`) die with it rather than being
//! orphaned.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;
use tokio::process::Command;
use tokio::sync::Notify;

#[derive(Debug, Serialize)]
pub struct CommandOutput {
    /// `None` when the process was killed for timing out or being
    /// cancelled, or (rare, only on some platforms) terminated by a signal
    /// rather than exiting.
    pub exit_code: Option<i32>,
    /// stdout and stderr, concatenated in that order -- callers that need
    /// them separated should say so; nothing here has needed it yet.
    pub output: String,
    pub timed_out: bool,
    /// The caller cancelled it via `cancel_shell_command` before it exited.
    pub cancelled: bool,
}

/// In-flight executions that were started with an `execution_id`, so
/// `cancel_shell_command` can reach them. Entries are removed when the
/// execution finishes for any reason (see `CancelRegistration`).
fn cancel_registry() -> &'static Mutex<HashMap<String, Arc<Notify>>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, Arc<Notify>>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Removes the execution's registry entry on drop, whichever way
/// `run_shell_command` returns (exit, timeout, cancel, spawn error).
struct CancelRegistration {
    id: Option<String>,
    notify: Arc<Notify>,
}

impl CancelRegistration {
    fn new(id: Option<String>) -> Self {
        let notify = Arc::new(Notify::new());
        if let Some(id) = &id {
            cancel_registry()
                .lock()
                .unwrap()
                .insert(id.clone(), notify.clone());
        }
        Self { id, notify }
    }
}

impl Drop for CancelRegistration {
    fn drop(&mut self) {
        if let Some(id) = &self.id {
            cancel_registry().lock().unwrap().remove(id);
        }
    }
}

/// Kills every process in the child's process group (Unix only -- the
/// child was started as its own group leader below). `kill_on_drop` still
/// covers the direct child on every platform; this reaches its children.
#[cfg(unix)]
fn kill_process_group(pid: Option<u32>) {
    if let Some(pid) = pid {
        // SAFETY: plain libc call with a pid we spawned ourselves; a
        // negative pid addresses the whole group. ESRCH (already gone) is
        // harmless and ignored.
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
    }
}

#[cfg(not(unix))]
fn kill_process_group(_pid: Option<u32>) {}

/// Spawns `program args...` in `cwd`, waits up to `timeout_ms` (or until
/// `cancel_shell_command(execution_id)` is called), and returns its
/// captured output. A `program` that doesn't exist, or a `cwd` that
/// doesn't, surfaces as `Err` (a real invocation failure, not a command
/// that ran and failed) -- everything else, including a nonzero exit code,
/// comes back as `Ok(CommandOutput)` for the caller to interpret.
#[tauri::command]
pub async fn run_shell_command(
    program: String,
    args: Vec<String>,
    cwd: String,
    timeout_ms: u64,
    execution_id: Option<String>,
) -> Result<CommandOutput, String> {
    println!(
        "Rust [run_shell_command] {} {} (cwd: {})",
        program,
        args.join(" "),
        cwd
    );

    let registration = CancelRegistration::new(execution_id);

    let mut command = Command::new(&program);
    command
        .args(&args)
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // If the timeout or a cancel fires below, `wait_with_output()`'s
        // `Child` is dropped without being awaited to completion --
        // kill_on_drop turns that drop into an actual kill signal to the
        // OS process, instead of leaving it orphaned and still running.
        .kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);

    let child = command
        .spawn()
        .map_err(|error| format!("Failed to start '{program}': {error}"))?;
    let pid = child.id();

    let waited = tokio::select! {
        waited = tokio::time::timeout(Duration::from_millis(timeout_ms.max(1)), child.wait_with_output()) => waited,
        _ = registration.notify.notified() => {
            kill_process_group(pid);
            return Ok(CommandOutput { exit_code: None, output: String::new(), timed_out: false, cancelled: true });
        }
    };

    match waited {
        Ok(Ok(output)) => {
            let mut combined = String::from_utf8_lossy(&output.stdout).into_owned();
            combined.push_str(&String::from_utf8_lossy(&output.stderr));
            Ok(CommandOutput {
                exit_code: output.status.code(),
                output: combined,
                timed_out: false,
                cancelled: false,
            })
        }
        Ok(Err(error)) => Err(format!("'{program}' failed: {error}")),
        Err(_elapsed) => {
            kill_process_group(pid);
            Ok(CommandOutput {
                exit_code: None,
                output: String::new(),
                timed_out: true,
                cancelled: false,
            })
        }
    }
}

/// Kills the in-flight `run_shell_command` started with this
/// `execution_id`. Returns whether one was found -- `false` means it had
/// already finished (or never started), which callers treat as done.
#[tauri::command]
pub fn cancel_shell_command(execution_id: String) -> bool {
    match cancel_registry().lock().unwrap().remove(&execution_id) {
        Some(notify) => {
            notify.notify_one();
            true
        }
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn captures_stdout_and_a_zero_exit_code() {
        let result =
            run_shell_command("echo".into(), vec!["hello".into()], ".".into(), 5_000, None)
                .await
                .expect("echo should run");
        assert_eq!(result.exit_code, Some(0));
        assert!(
            result.output.contains("hello"),
            "output was: {:?}",
            result.output
        );
        assert!(!result.timed_out);
        assert!(!result.cancelled);
    }

    #[tokio::test]
    async fn reports_a_nonzero_exit_code_as_ok_not_err() {
        let result = run_shell_command(
            "sh".into(),
            vec!["-c".into(), "exit 3".into()],
            ".".into(),
            5_000,
            None,
        )
        .await
        .expect("sh should run");
        assert_eq!(result.exit_code, Some(3));
        assert!(!result.timed_out);
    }

    #[tokio::test]
    async fn a_command_that_outlives_its_timeout_is_reported_as_timed_out() {
        let result = run_shell_command(
            "sh".into(),
            vec!["-c".into(), "sleep 5".into()],
            ".".into(),
            100,
            None,
        )
        .await
        .expect("the timeout path is Ok, not Err");
        assert!(result.timed_out);
        assert!(!result.cancelled);
        assert_eq!(result.exit_code, None);
    }

    #[tokio::test]
    async fn a_nonexistent_program_is_a_real_error() {
        let result = run_shell_command(
            "this-program-does-not-exist-anywhere".into(),
            vec![],
            ".".into(),
            5_000,
            None,
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn cancelling_an_in_flight_command_kills_it_and_reports_cancelled() {
        let id = "test-cancel-1".to_string();
        let running = tokio::spawn(run_shell_command(
            "sh".into(),
            vec!["-c".into(), "sleep 30".into()],
            ".".into(),
            60_000,
            Some(id.clone()),
        ));
        // Give the command a moment to register and spawn.
        for _ in 0..50 {
            if cancel_registry().lock().unwrap().contains_key(&id) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let started = std::time::Instant::now();
        assert!(
            cancel_shell_command(id.clone()),
            "the execution should have been registered"
        );
        let result = running
            .await
            .expect("task should not panic")
            .expect("the cancel path is Ok, not Err");
        assert!(result.cancelled);
        assert!(!result.timed_out);
        assert_eq!(result.exit_code, None);
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "cancel should not wait for the sleep to finish"
        );
        assert!(
            !cancel_registry().lock().unwrap().contains_key(&id),
            "the registration must be cleaned up"
        );
    }

    #[tokio::test]
    async fn cancelling_an_unknown_execution_is_a_no_op() {
        assert!(!cancel_shell_command("never-started".into()));
    }

    #[tokio::test]
    async fn a_finished_command_leaves_no_registration_behind() {
        let id = "test-cleanup-1".to_string();
        run_shell_command(
            "echo".into(),
            vec!["hi".into()],
            ".".into(),
            5_000,
            Some(id.clone()),
        )
        .await
        .expect("echo should run");
        assert!(!cancel_registry().lock().unwrap().contains_key(&id));
    }
}
