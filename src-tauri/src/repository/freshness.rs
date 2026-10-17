//! Cheap staleness check: which indexed files changed on disk since the snapshot was built.
//!
//! This only reads file metadata (no content, no scan). Files added since the snapshot are not
//! detected until the next refresh.
use std::time::UNIX_EPOCH;

use super::{dto::Freshness, entry::Entry, error::RepositoryError};

impl Entry {
    pub fn freshness(&self) -> Result<Freshness, RepositoryError> {
        let snapshot = self.snapshot()?;
        let built_at = self.built_at_ms();
        let tracked = snapshot
            .imports
            .files
            .iter()
            .map(|file| &file.path)
            .chain(
                snapshot
                    .graph
                    .packages
                    .iter()
                    .map(|package| &package.manifest),
            )
            .chain(snapshot.imports.configs.iter().map(|config| &config.path))
            .collect::<std::collections::BTreeSet<_>>();
        let (mut changed, mut missing) = (Vec::new(), Vec::new());
        for file in &tracked {
            let label = file.as_path().display().to_string();
            match std::fs::metadata(self.root.join(file.as_path())) {
                Ok(metadata) => {
                    let modified = metadata
                        .modified()
                        .ok()
                        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                        .map(|elapsed| elapsed.as_millis() as u64);
                    if let (Some(modified), Some(built_at)) = (modified, built_at) {
                        if modified > built_at {
                            changed.push(label);
                        }
                    }
                }
                Err(_) => missing.push(label),
            }
        }
        Ok(Freshness {
            built_at_ms: built_at,
            checked: tracked.len(),
            changed,
            missing,
        })
    }
}
