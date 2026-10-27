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
    /// stdout and stderr as they arrived. Kept when the command is stopped,
    /// so a caller can say how far it got; only the last [`MAX_CAPTURE`]
    /// bytes when it printed more (the whole of it is in `log_path`).
    pub output: String,
    pub timed_out: bool,
    /// Stopped because it printed nothing for `idle_timeout_ms` (a hang),
    /// rather than for its overall limit. `timed_out` is set too.
    pub idle: bool,
    /// The caller cancelled it via `cancel_shell_command` before it exited.
    pub cancelled: bool,
    /// `output` lost its beginning because the command printed more than
    /// [`MAX_CAPTURE`] bytes.
    pub truncated: bool,
    /// The full output, kept when the command was stopped or `output` was
    /// truncated; removed otherwise.
    pub log_path: Option<String>,
    pub elapsed_ms: u64,
}

/// How much output is held in memory and returned; the rest is in the log.
const MAX_CAPTURE: usize = 2 * 1024 * 1024;

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

/// What a command printed so far: the last [`MAX_CAPTURE`] bytes in memory,
/// all of it in a log file.
struct Capture {
    bytes: Vec<u8>,
    truncated: bool,
    log: Option<(std::path::PathBuf, tokio::fs::File)>,
}

impl Capture {
    async fn open() -> Self {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join("rusty-commands");
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |since| since.as_millis());
        let number = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let path = dir.join(format!("{stamp}-{}-{number}.log", std::process::id()));
        let log = match tokio::fs::create_dir_all(&dir).await {
            Ok(()) => tokio::fs::File::create(&path)
                .await
                .ok()
                .map(|file| (path, file)),
            Err(_) => None,
        };
        Self {
            bytes: Vec::new(),
            truncated: false,
            log,
        }
    }

    async fn push(&mut self, chunk: &[u8]) {
        use tokio::io::AsyncWriteExt;
        if let Some((_, file)) = &mut self.log {
            let _ = file.write_all(chunk).await;
        }
        self.bytes.extend_from_slice(chunk);
        if self.bytes.len() > MAX_CAPTURE {
            let cut = self.bytes.len() - MAX_CAPTURE;
            self.bytes.drain(..cut);
            self.truncated = true;
        }
    }

    /// The output, and the log's path when it is worth keeping.
    async fn finish(mut self, keep_log: bool) -> (String, bool, Option<String>) {
        use tokio::io::AsyncWriteExt;
        let keep = keep_log || self.truncated;
        let path = match self.log.take() {
            Some((path, mut file)) => {
                let _ = file.flush().await;
                drop(file);
                if keep {
                    Some(path.to_string_lossy().into_owned())
                } else {
                    let _ = tokio::fs::remove_file(&path).await;
                    None
                }
            }
            None => None,
        };
        (
            String::from_utf8_lossy(&self.bytes).into_owned(),
            self.truncated,
            path,
        )
    }
}

/// Forwards what `reader` prints as it arrives, until it closes.
fn forward(
    mut reader: impl tokio::io::AsyncRead + Unpin + Send + 'static,
    chunks: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
) {
    use tokio::io::AsyncReadExt;
    tokio::spawn(async move {
        let mut buffer = vec![0u8; 16 * 1024];
        loop {
            match reader.read(&mut buffer).await {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    if chunks.send(buffer[..read].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });
}

/// Why a command stopped before it exited.
enum Stopped {
    Timeout,
    Idle,
    Cancelled,
}

/// Spawns `program args...` in `cwd` and returns what it printed and how it
/// ended. It is stopped (its whole process group killed) after `timeout_ms`,
/// after `idle_timeout_ms` without printing anything when that is given (a
/// long build or test run keeps printing; a hung one does not), or when
/// `cancel_shell_command(execution_id)` is called. A stopped command keeps
/// the output it had printed, and its full log. A `program` that doesn't
/// exist, or a `cwd` that doesn't, surfaces as `Err` (a real invocation
/// failure, not a command that ran and failed) -- everything else,
/// including a nonzero exit code, comes back as `Ok(CommandOutput)` for the
/// caller to interpret.
#[tauri::command]
pub async fn run_shell_command(
    program: String,
    args: Vec<String>,
    cwd: String,
    timeout_ms: u64,
    execution_id: Option<String>,
    idle_timeout_ms: Option<u64>,
) -> Result<CommandOutput, String> {
    println!(
        "Rust [run_shell_command] {} {} (cwd: {})",
        program,
        args.join(" "),
        cwd
    );

    let registration = CancelRegistration::new(execution_id);

    let mut command = Command::new(&program);
    // Finder/Dock sessions need the same executable search path as MCP tools.
    #[cfg(feature = "core-harness")]
    if let Some(path) = crate::harness::user_path::user_path() {
        command.env("PATH", path);
    }
    command
        .args(&args)
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // If the command is stopped below, the `Child` is dropped without
        // being awaited to completion -- kill_on_drop turns that drop into an
        // actual kill signal to the OS process, instead of leaving it
        // orphaned and still running.
        .kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);

    let started = tokio::time::Instant::now();
    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to start '{program}': {error}"))?;
    let pid = child.id();
    let (chunks, mut printed) = tokio::sync::mpsc::unbounded_channel();
    if let Some(stdout) = child.stdout.take() {
        forward(stdout, chunks.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        forward(stderr, chunks.clone());
    }
    drop(chunks);

    let mut capture = Capture::open().await;
    let deadline = started + Duration::from_millis(timeout_ms.max(1));
    let idle = idle_timeout_ms.map(|ms| Duration::from_millis(ms.max(1)));
    let mut last_output = started;
    let mut exit_status = None;
    // A process it started in the background can keep the streams open after
    // it exits; what it printed by then is read for a moment, not waited for.
    let mut drained_by = deadline;
    let mut streams_open = true;
    let stopped = loop {
        let idle_deadline = idle.map(|idle| last_output + idle).unwrap_or(deadline);
        if exit_status.is_some() && (!streams_open || tokio::time::Instant::now() >= drained_by) {
            break None;
        }
        tokio::select! {
            chunk = printed.recv(), if streams_open => match chunk {
                Some(chunk) => {
                    last_output = tokio::time::Instant::now();
                    capture.push(&chunk).await;
                }
                None => streams_open = false,
            },
            status = child.wait(), if exit_status.is_none() => match status {
                Ok(status) => {
                    exit_status = Some(status);
                    drained_by = tokio::time::Instant::now() + Duration::from_secs(2);
                }
                Err(error) => return Err(format!("'{program}' failed: {error}")),
            },
            _ = tokio::time::sleep_until(drained_by), if exit_status.is_some() => {}
            _ = tokio::time::sleep_until(deadline) => break Some(Stopped::Timeout),
            _ = tokio::time::sleep_until(idle_deadline), if exit_status.is_none() && idle.is_some() => break Some(Stopped::Idle),
            _ = registration.notify.notified() => break Some(Stopped::Cancelled),
        }
    };
    let elapsed_ms = started.elapsed().as_millis() as u64;
    if stopped.is_some() {
        kill_process_group(pid);
        // What it printed before it died is still worth having.
        while let Ok(chunk) = printed.try_recv() {
            capture.push(&chunk).await;
        }
    }
    let (output, truncated, log_path) = capture.finish(stopped.is_some()).await;
    Ok(CommandOutput {
        exit_code: if stopped.is_some() {
            None
        } else {
            exit_status.and_then(|status| status.code())
        },
        output,
        timed_out: matches!(stopped, Some(Stopped::Timeout | Stopped::Idle)),
        idle: matches!(stopped, Some(Stopped::Idle)),
        cancelled: matches!(stopped, Some(Stopped::Cancelled)),
        truncated,
        log_path,
        elapsed_ms,
    })
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
        let result = run_shell_command(
            "echo".into(),
            vec!["hello".into()],
            ".".into(),
            5_000,
            None,
            None,
        )
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
            None,
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
            None,
        )
        .await
        .expect("echo should run");
        assert!(!cancel_registry().lock().unwrap().contains_key(&id));
    }

    #[tokio::test]
    async fn a_stopped_command_keeps_what_it_printed_and_its_log() {
        let result = run_shell_command(
            "sh".into(),
            vec!["-c".into(), "echo compiling crate-a; sleep 5".into()],
            ".".into(),
            300,
            None,
            None,
        )
        .await
        .expect("the timeout path is Ok, not Err");
        assert!(result.timed_out && !result.idle);
        assert!(
            result.output.contains("compiling crate-a"),
            "{:?}",
            result.output
        );
        let log = result.log_path.expect("a stopped command keeps its log");
        assert!(std::fs::read_to_string(&log)
            .unwrap()
            .contains("compiling crate-a"));
        let _ = std::fs::remove_file(log);
    }

    #[tokio::test]
    async fn a_command_that_stops_printing_is_stopped_for_idleness() {
        let started = std::time::Instant::now();
        let result = run_shell_command(
            "sh".into(),
            vec!["-c".into(), "echo started; sleep 30".into()],
            ".".into(),
            60_000,
            None,
            Some(300),
        )
        .await
        .expect("the idle path is Ok, not Err");
        assert!(result.timed_out && result.idle);
        assert!(result.output.contains("started"));
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "it did not wait for the overall limit"
        );
        if let Some(log) = result.log_path {
            let _ = std::fs::remove_file(log);
        }
    }

    #[tokio::test]
    async fn a_long_command_that_keeps_printing_is_not_idle() {
        // Longer than the idle limit in all, but never quiet for that long.
        let result = run_shell_command(
            "sh".into(),
            vec![
                "-c".into(),
                "for i in 1 2 3 4 5 6; do echo step $i; sleep 0.1; done".into(),
            ],
            ".".into(),
            10_000,
            None,
            Some(400),
        )
        .await
        .expect("sh should run");
        assert_eq!(result.exit_code, Some(0));
        assert!(!result.timed_out);
        assert!(result.output.contains("step 6"));
        assert!(
            result.log_path.is_none(),
            "a command that finished normally leaves no log"
        );
        assert!(result.elapsed_ms >= 500);
    }

    #[tokio::test]
    async fn stdout_and_stderr_are_both_captured() {
        let result = run_shell_command(
            "sh".into(),
            vec!["-c".into(), "echo out; echo err 1>&2; exit 2".into()],
            ".".into(),
            5_000,
            None,
            None,
        )
        .await
        .expect("sh should run");
        assert_eq!(result.exit_code, Some(2));
        assert!(
            result.output.contains("out") && result.output.contains("err"),
            "{:?}",
            result.output
        );
    }
}
