//! What a running command has printed so far. A command run in the
//! background (a test suite that takes ten minutes) is still a
//! `run_shell_command` call the IDE is waiting on; this lets it read the end of
//! the output, the log's path and the time so far while it runs, by the
//! `execution_id` it started the command with.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

use serde::Serialize;

/// How much of the latest output is kept for a progress read.
const TAIL: usize = 16 * 1024;

struct Progress {
    tail: Mutex<Vec<u8>>,
    log_path: Option<String>,
    started: Instant,
}

fn registry() -> &'static Mutex<HashMap<String, Arc<Progress>>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, Arc<Progress>>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

/// A running command's entry; removed when it is dropped, however the command ended.
pub(crate) struct ProgressRegistration {
    id: Option<String>,
    progress: Option<Arc<Progress>>,
}

impl ProgressRegistration {
    /// Registers the command when it was started with an id; otherwise nothing is kept.
    pub(crate) fn new(id: Option<&str>, log_path: Option<String>) -> Self {
        let Some(id) = id else {
            return Self {
                id: None,
                progress: None,
            };
        };
        let progress = Arc::new(Progress {
            tail: Mutex::new(Vec::new()),
            log_path,
            started: Instant::now(),
        });
        registry()
            .lock()
            .unwrap()
            .insert(id.to_owned(), progress.clone());
        Self {
            id: Some(id.to_owned()),
            progress: Some(progress),
        }
    }

    pub(crate) fn push(&self, chunk: &[u8]) {
        let Some(progress) = &self.progress else {
            return;
        };
        let mut tail = progress.tail.lock().unwrap();
        tail.extend_from_slice(chunk);
        if tail.len() > TAIL {
            let cut = tail.len() - TAIL;
            tail.drain(..cut);
        }
    }
}

impl Drop for ProgressRegistration {
    fn drop(&mut self) {
        if let Some(id) = &self.id {
            registry().lock().unwrap().remove(id);
        }
    }
}

#[derive(Debug, Serialize)]
pub struct CommandProgress {
    /// The end of what it printed so far.
    pub output: String,
    /// Everything it printed so far.
    pub log_path: Option<String>,
    pub elapsed_ms: u64,
}

/// The progress of a running command, or `None` once it has finished (its
/// result went to the `run_shell_command` call) or when no such id ran.
#[tauri::command]
pub fn shell_command_progress(execution_id: String) -> Option<CommandProgress> {
    let progress = registry().lock().unwrap().get(&execution_id).cloned()?;
    let output = String::from_utf8_lossy(&progress.tail.lock().unwrap()).into_owned();
    Some(CommandProgress {
        output,
        log_path: progress.log_path.clone(),
        elapsed_ms: progress.started.elapsed().as_millis() as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_running_command_shows_the_end_of_its_output_until_it_ends() {
        let registration = ProgressRegistration::new(Some("progress-1"), Some("/tmp/x.log".into()));
        registration.push(b"compiling\n");
        registration.push(&vec![b'x'; TAIL]);
        registration.push(b"\nrunning 4 tests\n");
        let seen = shell_command_progress("progress-1".into()).expect("registered");
        assert!(seen.output.ends_with("running 4 tests\n"));
        assert!(!seen.output.contains("compiling"), "only the tail is kept");
        assert_eq!(seen.log_path.as_deref(), Some("/tmp/x.log"));
        drop(registration);
        assert!(shell_command_progress("progress-1".into()).is_none());
    }

    #[test]
    fn a_command_without_an_id_is_not_registered() {
        let registration = ProgressRegistration::new(None, None);
        registration.push(b"hello");
        assert!(
            registry().lock().unwrap().is_empty() || shell_command_progress("".into()).is_none()
        );
    }
}
