//! Conservative run-local check invalidation, including dirty/untracked files
//! and installed dependencies. No shell command and no Git-root assumption.
use sha2::{Digest, Sha256};
use std::path::Path;

fn fingerprint(root: &Path) -> Result<String, String> {
    fn visit(root: &Path, dir: &Path, hash: &mut Sha256, count: &mut usize) -> Result<(), String> {
        let mut entries = std::fs::read_dir(dir)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        entries.sort_by_key(|e| e.file_name());
        for entry in entries {
            *count += 1;
            if *count > 250_000 {
                return Err("workspace too large for safe evidence reuse".into());
            }
            let path = entry.path();
            let relative = path.strip_prefix(root).map_err(|e| e.to_string())?;
            if relative.starts_with(".rusty/observability") || relative.starts_with(".rusty/chats")
            {
                continue;
            }
            let meta = std::fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
            if entry.file_name() == ".git" && meta.is_file() {
                return Err("linked Git metadata requires fresh checks".into());
            }
            hash.update(relative.to_string_lossy().as_bytes());
            if meta.file_type().is_symlink() {
                // External/linked inputs cannot be proven unchanged by this
                // workspace snapshot. Disable reuse rather than trust them.
                let target = path.canonicalize().map_err(|e| e.to_string())?;
                if !target.starts_with(root) {
                    return Err("external linked inputs require fresh checks".into());
                }
                hash.update(target.to_string_lossy().as_bytes());
                continue; // Its real path is visited elsewhere in this tree.
            }
            if meta.is_dir() {
                visit(root, &path, hash, count)?;
            } else {
                hash.update(meta.len().to_le_bytes());
                hash.update(
                    meta.modified()
                        .map_err(|e| e.to_string())?
                        .duration_since(std::time::UNIX_EPOCH)
                        .map_err(|e| e.to_string())?
                        .as_nanos()
                        .to_le_bytes(),
                );
                #[cfg(unix)]
                {
                    use std::os::unix::fs::MetadataExt;
                    hash.update(meta.ctime().to_le_bytes());
                    hash.update(meta.ctime_nsec().to_le_bytes());
                    hash.update(meta.ino().to_le_bytes());
                    hash.update(meta.mode().to_le_bytes());
                }
                // Content hashing avoids relying on coarse modification times
                // on platforms without a change-time field.
                #[cfg(not(unix))]
                {
                    hash.update(std::fs::read(&path).map_err(|e| e.to_string())?);
                }
            }
        }
        Ok(())
    }
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    hash.update(root.to_string_lossy().as_bytes());
    let mut environment = std::env::vars_os().collect::<Vec<_>>();
    environment.sort_by(|a, b| a.0.cmp(&b.0));
    for (key, value) in environment {
        hash.update(key.to_string_lossy().as_bytes());
        hash.update(value.to_string_lossy().as_bytes());
    }
    visit(&root, &root, &mut hash, &mut 0)?;
    Ok(format!("{:x}", hash.finalize()))
}

#[tauri::command]
pub async fn check_workspace_fingerprint(root: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || fingerprint(Path::new(&root)))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn changes_when_untracked_input_or_dependency_changes() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("source"), "before").unwrap();
        let before = fingerprint(dir.path()).unwrap();
        std::fs::write(dir.path().join("source"), "after!").unwrap();
        assert_ne!(before, fingerprint(dir.path()).unwrap());
        let before = fingerprint(dir.path()).unwrap();
        std::fs::create_dir(dir.path().join("node_modules")).unwrap();
        std::fs::write(dir.path().join("node_modules/input"), "dep").unwrap();
        assert_ne!(before, fingerprint(dir.path()).unwrap());
    }
}
