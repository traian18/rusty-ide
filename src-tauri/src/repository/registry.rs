//! One [`Entry`] per repository root, held in Tauri's managed state, plus the directory of a
//! workspace's repositories. A workspace folder can hold many repositories, so the registry is
//! bounded: a few indexes are kept in memory (the least recently used is dropped) and only a few
//! repositories are indexed at once.
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
};

use super::{
    directory::RepositoryDirectory,
    entry::Entry,
    error::RepositoryError,
    jobs::{JobRegistry, Notify},
    storage::repository_dir,
};

/// Repository indexes kept in memory at once.
pub const MAX_LOADED: usize = 8;
/// Repositories indexed at once.
pub const MAX_INDEXING: usize = 2;

struct Inner {
    entries: Mutex<HashMap<PathBuf, (Arc<Entry>, u64)>>,
    tick: AtomicU64,
    indexing: Arc<tokio::sync::Semaphore>,
    directory: RepositoryDirectory,
    /// Where repositories keep their work between runs; `None` keeps everything in memory.
    data_dir: Mutex<Option<PathBuf>>,
    jobs: JobRegistry,
    /// Whether analysis runs by itself (on first open, after changes, on start).
    background: AtomicBool,
}

/// Cheap to clone: every clone shares the same repositories.
#[derive(Clone)]
pub struct RepositoryState {
    inner: Arc<Inner>,
}

impl Default for RepositoryState {
    fn default() -> Self {
        Self::with_directory(RepositoryDirectory::git())
    }
}

impl RepositoryState {
    pub fn new() -> Self {
        Self::default()
    }

    /// A registry that discovers repositories through `directory` (tests supply their own).
    pub fn with_directory(directory: RepositoryDirectory) -> Self {
        Self {
            inner: Arc::new(Inner {
                entries: Mutex::new(HashMap::new()),
                tick: AtomicU64::new(0),
                indexing: Arc::new(tokio::sync::Semaphore::new(MAX_INDEXING)),
                directory,
                data_dir: Mutex::new(None),
                jobs: JobRegistry::default(),
                background: AtomicBool::new(true),
            }),
        }
    }

    pub fn directory(&self) -> &RepositoryDirectory {
        &self.inner.directory
    }

    /// Keeps each repository's work under `data_dir` and tells `notify` about jobs and finished
    /// analyses. Without it everything stays in memory and nothing runs by itself (tests).
    pub fn configure(&self, data_dir: PathBuf, notify: Notify) {
        *self.inner.data_dir.lock().expect("registry lock") = Some(data_dir);
        self.inner.jobs.set_notify(notify);
    }

    pub fn jobs(&self) -> &JobRegistry {
        &self.inner.jobs
    }

    pub fn background_enabled(&self) -> bool {
        self.inner.background.load(Ordering::Relaxed)
    }

    pub fn set_background(&self, enabled: bool) {
        self.inner.background.store(enabled, Ordering::Relaxed);
    }

    pub(super) fn loaded_entries(&self) -> Vec<Arc<Entry>> {
        self.inner
            .entries
            .lock()
            .expect("registry lock")
            .values()
            .map(|(entry, _)| entry.clone())
            .collect()
    }

    fn touch(&self) -> u64 {
        self.inner.tick.fetch_add(1, Ordering::Relaxed)
    }

    /// The services for `root`, created on first use. Roots are keyed by canonical path, so two
    /// spellings of one directory share services and different directories never do.
    pub fn entry(&self, root: &str) -> Result<Arc<Entry>, RepositoryError> {
        let canonical = std::fs::canonicalize(Path::new(root)).map_err(|error| {
            RepositoryError::invalid(format!("workspace root is not usable: {error}"))
        })?;
        let mut entries = self.inner.entries.lock().expect("registry lock");
        let tick = self.touch();
        if let Some((entry, used)) = entries.get_mut(&canonical) {
            *used = tick;
            return Ok(entry.clone());
        }
        let storage = self
            .inner
            .data_dir
            .lock()
            .expect("registry lock")
            .as_deref()
            .map(|d| repository_dir(d, &canonical));
        let entry = Arc::new(
            Entry::open(&canonical, storage.as_deref())?
                .with_indexing_limit(self.inner.indexing.clone()),
        );
        entries.insert(canonical, (entry.clone(), tick));
        Self::evict(&mut entries);
        drop(entries);
        self.resume(&entry);
        Ok(entry)
    }

    /// The services for `root` if they are loaded; never creates them.
    pub fn peek(&self, root: &Path) -> Option<Arc<Entry>> {
        let canonical = std::fs::canonicalize(root).ok()?;
        self.inner
            .entries
            .lock()
            .expect("registry lock")
            .get(&canonical)
            .map(|(entry, _)| entry.clone())
    }

    /// Drops the least recently used indexes beyond [`MAX_LOADED`], never one that is in use.
    fn evict(entries: &mut HashMap<PathBuf, (Arc<Entry>, u64)>) {
        while entries.len() > MAX_LOADED {
            let oldest = entries
                .iter()
                .filter(|(_, (entry, _))| Arc::strong_count(entry) == 1)
                .min_by_key(|(_, (_, used))| *used)
                .map(|(root, _)| root.clone());
            match oldest {
                Some(root) => {
                    entries.remove(&root);
                }
                None => break,
            }
        }
    }

    /// Number of repositories whose services are loaded.
    pub fn loaded(&self) -> usize {
        self.inner.entries.lock().expect("registry lock").len()
    }

    /// Forgets a workspace's services (and with them its snapshots).
    pub fn close(&self, root: &str) {
        if let Ok(canonical) = std::fs::canonicalize(Path::new(root)) {
            if let Some((entry, _)) = self
                .inner
                .entries
                .lock()
                .expect("registry lock")
                .remove(&canonical)
            {
                entry.cancel_refresh();
            }
        }
    }
}

impl std::fmt::Debug for RepositoryState {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("RepositoryState")
            .field("loaded", &self.loaded())
            .finish()
    }
}
