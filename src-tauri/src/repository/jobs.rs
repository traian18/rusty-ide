//! The work running in the background, for the process bubble: each job has a label, progress, a
//! state and its own cancel. Jobs run by the host (analysis) and by the frontend (documentation,
//! whose model calls go through the chat routing) are registered here alike, so one list shows
//! everything and one × stops any of them.
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};

use serde::Serialize;
use tokio_util::sync::CancellationToken;

/// Finished jobs kept so the bubble can show how they ended.
const KEEP_FINISHED: usize = 8;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JobKind {
    Analysis,
    Documentation,
    /// Re-scoring past commits for the health trend.
    History,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JobState {
    Running,
    Finished,
    Failed,
    Cancelled,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: u64,
    pub kind: JobKind,
    /// The repository root it works on.
    pub root: String,
    pub label: String,
    /// What it is doing right now.
    pub detail: Option<String>,
    pub done: Option<u32>,
    pub total: Option<u32>,
    pub state: JobState,
    pub message: Option<String>,
}

/// What the registry tells the rest of the app.
#[derive(Clone, Debug)]
pub enum Notice {
    Jobs(Vec<Job>),
    /// A repository's stored analysis was replaced: pages showing it should reload.
    AnalysisUpdated(String),
}

pub type Notify = Arc<dyn Fn(Notice) + Send + Sync>;

#[derive(Default)]
pub struct JobRegistry {
    jobs: Mutex<Vec<(Job, CancellationToken)>>,
    next: AtomicU64,
    notify: Mutex<Option<Notify>>,
}

impl JobRegistry {
    pub fn set_notify(&self, notify: Notify) {
        *self.notify.lock().unwrap_or_else(|e| e.into_inner()) = Some(notify);
    }

    pub fn tell(&self, notice: Notice) {
        let notify = self
            .notify
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        if let Some(notify) = notify {
            notify(notice);
        }
    }

    fn changed(&self) {
        self.tell(Notice::Jobs(self.list()));
    }

    pub fn list(&self) -> Vec<Job> {
        self.jobs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .map(|(job, _)| job.clone())
            .collect()
    }

    /// Registers a running job and returns its id and the token that stops it.
    pub fn start(&self, kind: JobKind, root: &str, label: &str) -> (u64, CancellationToken) {
        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        let token = CancellationToken::new();
        {
            let mut jobs = self.jobs.lock().unwrap_or_else(|e| e.into_inner());
            jobs.push((
                Job {
                    id,
                    kind,
                    root: root.to_owned(),
                    label: label.to_owned(),
                    detail: None,
                    done: None,
                    total: None,
                    state: JobState::Running,
                    message: None,
                },
                token.clone(),
            ));
            // Drop the oldest finished jobs beyond the ones kept for display.
            let finished = jobs
                .iter()
                .filter(|(j, _)| j.state != JobState::Running)
                .count();
            let mut excess = finished.saturating_sub(KEEP_FINISHED);
            jobs.retain(|(j, _)| {
                if excess > 0 && j.state != JobState::Running {
                    excess -= 1;
                    false
                } else {
                    true
                }
            });
        }
        self.changed();
        (id, token)
    }

    pub fn progress(&self, id: u64, done: Option<u32>, total: Option<u32>, detail: Option<&str>) {
        {
            let mut jobs = self.jobs.lock().unwrap_or_else(|e| e.into_inner());
            let Some((job, _)) = jobs
                .iter_mut()
                .find(|(j, _)| j.id == id && j.state == JobState::Running)
            else {
                return;
            };
            job.done = done;
            job.total = total;
            job.detail = detail.map(str::to_owned);
        }
        self.changed();
    }

    /// Ends a job; a job already cancelled stays cancelled.
    pub fn finish(&self, id: u64, state: JobState, message: Option<&str>) {
        {
            let mut jobs = self.jobs.lock().unwrap_or_else(|e| e.into_inner());
            let Some((job, _)) = jobs.iter_mut().find(|(j, _)| j.id == id) else {
                return;
            };
            if job.state == JobState::Cancelled {
                return;
            }
            job.state = state;
            job.message = message.map(str::to_owned);
            job.detail = None;
        }
        self.changed();
    }

    /// Stops a running job; `false` when there is no such running job.
    pub fn cancel(&self, id: u64) -> bool {
        let token = {
            let mut jobs = self.jobs.lock().unwrap_or_else(|e| e.into_inner());
            let Some((job, token)) = jobs
                .iter_mut()
                .find(|(j, _)| j.id == id && j.state == JobState::Running)
            else {
                return false;
            };
            job.state = JobState::Cancelled;
            job.detail = None;
            token.clone()
        };
        token.cancel();
        self.changed();
        true
    }

    /// Removes a finished job from the list (the bubble's × on a job that already ended).
    pub fn dismiss(&self, id: u64) {
        self.jobs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .retain(|(j, _)| j.id != id || j.state == JobState::Running);
        self.changed();
    }

    pub fn running(&self, kind: JobKind, root: &str) -> bool {
        self.jobs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .any(|(j, _)| j.kind == kind && j.root == root && j.state == JobState::Running)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jobs_progress_finish_and_cancel_with_notices() {
        let registry = JobRegistry::default();
        let seen = Arc::new(Mutex::new(0));
        let counter = seen.clone();
        registry.set_notify(Arc::new(move |_| *counter.lock().unwrap() += 1));
        let (a, token) = registry.start(JobKind::Analysis, "/r", "Analysing r");
        registry.progress(a, Some(1), Some(3), Some("Reading the code"));
        assert_eq!(
            registry.list()[0].detail.as_deref(),
            Some("Reading the code")
        );
        assert!(registry.running(JobKind::Analysis, "/r"));
        assert!(registry.cancel(a));
        assert!(token.is_cancelled());
        registry.finish(a, JobState::Finished, None);
        assert_eq!(
            registry.list()[0].state,
            JobState::Cancelled,
            "a cancelled job stays cancelled"
        );
        let (b, _) = registry.start(JobKind::Documentation, "/r", "Updating documentation");
        registry.finish(b, JobState::Failed, Some("no model"));
        assert!(!registry.cancel(b));
        registry.dismiss(b);
        assert_eq!(registry.list().len(), 1);
        assert!(*seen.lock().unwrap() >= 6);
    }
}
