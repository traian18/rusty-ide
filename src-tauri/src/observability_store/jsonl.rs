//! The files under the history directory: private directories, append-only
//! JSONL that survives a torn last line, and the directory's size.

use std::path::Path;

use serde_json::Value;
use tokio::fs;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

pub(super) async fn ensure_dir(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir)
        .await
        .map_err(|e| format!("failed to create {}: {e}", dir.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700)).await;
    }
    Ok(())
}

/// Keeps history out of the workspace's git repo without touching its own .gitignore.
pub(super) async fn ensure_gitignore(dir: &Path) {
    let path = dir.join(".gitignore");
    if fs::metadata(&path).await.is_err() {
        let _ = fs::write(&path, "*\n").await;
    }
}

async fn ends_mid_line(path: &Path) -> bool {
    let Ok(mut file) = fs::File::open(path).await else {
        return false;
    };
    let Ok(len) = file.metadata().await.map(|m| m.len()) else {
        return false;
    };
    if len == 0 || file.seek(std::io::SeekFrom::Start(len - 1)).await.is_err() {
        return false;
    }
    let mut last = [0u8; 1];
    file.read_exact(&mut last).await.is_ok() && last[0] != b'\n'
}

pub(super) async fn append_lines(path: &Path, lines: &[String]) -> Result<(), String> {
    if lines.is_empty() {
        return Ok(());
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await
        .map_err(|e| format!("failed to open {}: {e}", path.display()))?;
    let mut buf = String::with_capacity(lines.iter().map(|l| l.len() + 1).sum::<usize>() + 1);
    if ends_mid_line(path).await {
        // Isolate a torn line from a crashed write so it can't swallow this one.
        buf.push('\n');
    }
    for line in lines {
        buf.push_str(line);
        buf.push('\n');
    }
    file.write_all(buf.as_bytes())
        .await
        .map_err(|e| format!("failed to append to {}: {e}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).await;
    }
    Ok(())
}

pub(super) async fn read_jsonl(path: &Path) -> Vec<Value> {
    match fs::read_to_string(path).await {
        // A crash mid-append can leave one torn last line; skip anything unparsable.
        Ok(raw) => raw
            .lines()
            .filter_map(|line| serde_json::from_str(line).ok())
            .collect(),
        Err(_) => Vec::new(),
    }
}

pub(super) async fn dir_bytes(dir: &Path) -> u64 {
    let mut total = 0;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let Ok(mut entries) = fs::read_dir(&current).await else {
            continue;
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let Ok(meta) = entry.metadata().await else {
                continue;
            };
            if meta.is_dir() {
                stack.push(entry.path());
            } else {
                total += meta.len();
            }
        }
    }
    total
}
