//! One [`Entry`] per workspace root, held in Tauri's managed state.
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use super::{entry::Entry, error::RepositoryError};

#[derive(Default)]
pub struct RepositoryState {
    entries: Mutex<HashMap<PathBuf, Arc<Entry>>>,
}

impl RepositoryState {
    pub fn new() -> Self {
        Self::default()
    }

    /// The services for `root`, created on first use. Roots are keyed by canonical path, so two
    /// spellings of one directory share services and different directories never do.
    pub fn entry(&self, root: &str) -> Result<Arc<Entry>, RepositoryError> {
        let canonical = std::fs::canonicalize(Path::new(root)).map_err(|error| {
            RepositoryError::invalid(format!("workspace root is not usable: {error}"))
        })?;
        let mut entries = self.entries.lock().expect("registry lock");
        if let Some(entry) = entries.get(&canonical) {
            return Ok(entry.clone());
        }
        let entry = Arc::new(Entry::new(&canonical)?);
        entries.insert(canonical, entry.clone());
        Ok(entry)
    }

    /// Forgets a workspace's services (and with them its snapshots).
    pub fn close(&self, root: &str) {
        if let Ok(canonical) = std::fs::canonicalize(Path::new(root)) {
            if let Some(entry) = self
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
