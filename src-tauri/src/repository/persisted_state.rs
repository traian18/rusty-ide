//! User layout and notes for one workspace, kept in the app data directory (never in the repository).
//!
//! The host stores an opaque JSON document; its schema and versioning belong to the frontend.
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use super::error::RepositoryError;

/// Larger documents are refused so a bug cannot fill the disk.
const MAX_DOCUMENT_BYTES: usize = 4 * 1024 * 1024;

/// `<app data>/architecture/<hash of the canonical root>.json`.
pub fn state_path(app_data_dir: &Path, root: &Path) -> PathBuf {
    let digest = Sha256::digest(root.to_string_lossy().as_bytes());
    let name = digest
        .iter()
        .take(8)
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    app_data_dir
        .join("architecture")
        .join(format!("{name}.json"))
}

pub fn load(path: &Path) -> Result<Option<serde_json::Value>, RepositoryError> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map(Some).map_err(|error| {
            RepositoryError::new(
                "corrupt_state",
                format!("saved state is not valid JSON: {error}"),
            )
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(RepositoryError::new("io_error", error.to_string())),
    }
}

/// Writes atomically: a crash leaves either the old document or the new one.
pub fn save(path: &Path, document: &serde_json::Value) -> Result<(), RepositoryError> {
    let bytes = serde_json::to_vec(document)
        .map_err(|error| RepositoryError::invalid(error.to_string()))?;
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Err(RepositoryError::new(
            "limit_exceeded",
            "saved state is too large",
        ));
    }
    let io = |error: std::io::Error| RepositoryError::new("io_error", error.to_string());
    std::fs::create_dir_all(path.parent().unwrap_or(Path::new("."))).map_err(io)?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, bytes).map_err(io)?;
    std::fs::rename(&temporary, path).map_err(io)
}
