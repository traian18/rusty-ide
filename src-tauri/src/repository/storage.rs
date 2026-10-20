//! What survives a restart, per repository, in the app data directory (never in the repository):
//! the repository snapshot, the Git snapshot, code-health measurements, and the list of work not
//! done yet. Loading these is what lets a repository open without being scanned again.
//!
//! `<app data>/repositories/<hash of the canonical root>/` holds `snapshot.json`, `git.json`,
//! `health.json` and `pending.json`. Every write goes to a temporary file first, so a crash leaves
//! the old file or the new one.
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
    sync::Arc,
};

use harness_git_analysis::{
    GitAnalysisError, GitQueryError, GitSnapshot, GitSnapshotId, GitSnapshotRepository,
    InMemoryGitSnapshotRepository,
};
use harness_workspace::repository_intelligence::{
    DiscoveryError, InMemoryRepositorySnapshotRepository, RepositorySnapshot,
    RepositorySnapshotRepository, SnapshotId,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Snapshots kept in memory per repository.
const RETENTION: usize = 2;

/// `<app data>/repositories/<hash of root>`.
pub fn repository_dir(app_data_dir: &Path, root: &Path) -> PathBuf {
    let digest = Sha256::digest(root.to_string_lossy().as_bytes());
    let name: String = digest.iter().take(8).map(|b| format!("{b:02x}")).collect();
    app_data_dir.join("repositories").join(name)
}

pub fn read_json<T: DeserializeOwned>(path: &Path) -> Option<T> {
    let bytes = std::fs::read(path).ok()?;
    match serde_json::from_slice(&bytes) {
        Ok(value) => Some(value),
        Err(error) => {
            eprintln!(
                "Rust [repository storage] ignoring unreadable {}: {error}",
                path.display()
            );
            None
        }
    }
}

pub fn write_json<T: Serialize + ?Sized>(path: &Path, value: &T) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let bytes = serde_json::to_vec(value).map_err(std::io::Error::other)?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, bytes)?;
    std::fs::rename(&temporary, path)
}

/// When a stored file was last written, in milliseconds since the epoch.
pub fn written_at_ms(path: &Path) -> Option<u64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    modified
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as u64)
}

/// Repository snapshots in memory, the newest also on disk.
pub struct DiskSnapshots {
    memory: InMemoryRepositorySnapshotRepository,
    path: PathBuf,
}

impl DiskSnapshots {
    pub fn open(path: PathBuf) -> Result<Self, DiscoveryError> {
        let memory = InMemoryRepositorySnapshotRepository::new(RETENTION)?;
        if let Some(snapshot) = read_json::<RepositorySnapshot>(&path) {
            memory.publish(snapshot)?;
        }
        Ok(Self { memory, path })
    }
}

impl RepositorySnapshotRepository for DiskSnapshots {
    fn current(&self) -> Option<Arc<RepositorySnapshot>> {
        self.memory.current()
    }

    fn publish(&self, snapshot: RepositorySnapshot) -> Result<(), DiscoveryError> {
        if let Err(error) = write_json(&self.path, &snapshot) {
            eprintln!("Rust [repository storage] could not save the snapshot: {error}");
        }
        self.memory.publish(snapshot)
    }

    fn get(&self, id: &SnapshotId) -> Result<Arc<RepositorySnapshot>, DiscoveryError> {
        self.memory.get(id)
    }
}

/// Git snapshots in memory, the newest also on disk.
pub struct DiskGitSnapshots {
    memory: InMemoryGitSnapshotRepository,
    path: PathBuf,
}

impl DiskGitSnapshots {
    pub fn open(path: PathBuf) -> Result<Self, GitAnalysisError> {
        let memory = InMemoryGitSnapshotRepository::new(RETENTION)?;
        if let Some(snapshot) = read_json::<GitSnapshot>(&path) {
            memory.publish(snapshot)?;
        }
        Ok(Self { memory, path })
    }
}

impl GitSnapshotRepository for DiskGitSnapshots {
    fn current(&self) -> Option<Arc<GitSnapshot>> {
        self.memory.current()
    }

    fn publish(&self, snapshot: GitSnapshot) -> Result<(), GitAnalysisError> {
        if let Err(error) = write_json(&self.path, &snapshot) {
            eprintln!("Rust [repository storage] could not save the Git snapshot: {error}");
        }
        self.memory.publish(snapshot)
    }

    fn get(&self, id: &GitSnapshotId) -> Result<Arc<GitSnapshot>, GitQueryError> {
        self.memory.get(id)
    }
}

/// Work asked for and not finished: kept on disk so a restart picks it up.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingWork {
    /// The repository has never been analysed, or a full analysis was asked for.
    #[serde(default)]
    pub full_analysis: bool,
    /// Files changed since the last analysis, repository-relative.
    #[serde(default)]
    pub changed_files: BTreeSet<String>,
    /// Documentation pages the user agreed to update, and the model to write them with.
    #[serde(default)]
    pub documentation: Vec<String>,
    #[serde(default)]
    pub documentation_model: Option<String>,
}

impl PendingWork {
    pub fn is_empty(&self) -> bool {
        !self.full_analysis && self.changed_files.is_empty() && self.documentation.is_empty()
    }

    pub fn needs_analysis(&self) -> bool {
        self.full_analysis || !self.changed_files.is_empty()
    }
}

pub struct Storage {
    dir: PathBuf,
}

impl Storage {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    /// The app data directory this repository's folder sits in (`<app data>/repositories/<hash>`).
    pub fn app_data_dir(&self) -> Option<&Path> {
        self.dir.parent()?.parent()
    }

    pub fn snapshot_path(&self) -> PathBuf {
        self.dir.join("snapshot.json")
    }

    pub fn git_path(&self) -> PathBuf {
        self.dir.join("git.json")
    }

    pub fn health_path(&self) -> PathBuf {
        self.dir.join("health.json")
    }

    pub fn trend_path(&self) -> PathBuf {
        self.dir.join("trend.json")
    }

    fn pending_path(&self) -> PathBuf {
        self.dir.join("pending.json")
    }

    pub fn pending(&self) -> PendingWork {
        read_json(&self.pending_path()).unwrap_or_default()
    }

    pub fn update_pending(&self, change: impl FnOnce(&mut PendingWork)) -> PendingWork {
        let mut pending = self.pending();
        change(&mut pending);
        if let Err(error) = write_json(&self.pending_path(), &pending) {
            eprintln!("Rust [repository storage] could not save pending work: {error}");
        }
        pending
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_work_survives_and_snapshots_reload() {
        let dir = tempfile::tempdir().unwrap();
        let storage = Storage::new(dir.path().join("r"));
        assert!(storage.pending().is_empty());
        storage.update_pending(|p| {
            p.changed_files.insert("src/a.rs".into());
            p.documentation = vec!["written:overview".into()];
        });
        let again = Storage::new(dir.path().join("r")).pending();
        assert!(again.needs_analysis());
        assert_eq!(again.documentation, ["written:overview"]);
        let other = repository_dir(dir.path(), Path::new("/a"));
        assert_ne!(other, repository_dir(dir.path(), Path::new("/b")));
    }
}
