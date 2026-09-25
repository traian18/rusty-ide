// The PATH a user's own terminal would have, for spawning stdio MCP servers.
//
// Apps launched from Finder/the Dock on macOS (and from many Linux desktop
// launchers) inherit a minimal PATH like /usr/bin:/bin:/usr/sbin:/sbin, so
// `uvx`, an nvm-installed `npx`, or `~/.docker/bin/docker` fail to spawn with
// "No such file or directory" even though they work in the user's terminal.
// Resolved once per process by asking the user's login + interactive shell,
// since tools like nvm only hook in from interactive rc files.

use std::sync::OnceLock;

static USER_PATH: OnceLock<Option<String>> = OnceLock::new();

/// `None` on platforms where the inherited PATH is already the user's (Windows).
pub fn user_path() -> Option<&'static str> {
    USER_PATH.get_or_init(resolve).as_deref()
}

/// Whether `command` would be found when spawned with `path` as PATH.
pub fn resolves_on(command: &str, path: &str) -> bool {
    let candidate = std::path::Path::new(command);
    if candidate.components().count() > 1 {
        return candidate.is_file();
    }
    std::env::split_paths(path).any(|dir| dir.join(command).is_file())
}

#[cfg(not(unix))]
fn resolve() -> Option<String> {
    None
}

#[cfg(unix)]
fn resolve() -> Option<String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let fallbacks: Vec<String> = [".local/bin", ".cargo/bin", ".docker/bin"]
        .iter()
        .filter(|_| !home.is_empty())
        .map(|rel| format!("{home}/{rel}"))
        .chain(["/opt/homebrew/bin".to_string(), "/usr/local/bin".to_string()])
        .collect();

    Some(merge_paths(&[
        login_shell_path().unwrap_or_default(),
        std::env::var("PATH").unwrap_or_default(),
        fallbacks.join(":"),
    ]))
}

const MARKER: &str = "__RUSTY_USER_PATH__";

#[cfg(unix)]
fn login_shell_path() -> Option<String> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::time::Duration;

    let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty())?;
    let script = if shell.ends_with("fish") {
        format!("printf '%s%s%s' {MARKER} (string join : $PATH) {MARKER}")
    } else {
        format!("printf '%s%s%s' {MARKER} \"$PATH\" {MARKER}")
    };

    let mut child = Command::new(&shell)
        .args(["-i", "-l", "-c", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;

    // Read on a thread so a slow or hanging rc file can't block us past the
    // timeout; stop as soon as the marked value is complete, since an rc file
    // may leave a background process holding the pipe open.
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut output = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            match stdout.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    output.extend_from_slice(&chunk[..n]);
                    if extract_marked(&String::from_utf8_lossy(&output)).is_some() {
                        break;
                    }
                }
            }
        }
        let _ = tx.send(String::from_utf8_lossy(&output).into_owned());
    });

    let output = rx.recv_timeout(Duration::from_secs(5)).ok();
    let _ = child.kill();
    let _ = child.wait();
    extract_marked(&output?)
}

fn extract_marked(output: &str) -> Option<String> {
    let start = output.find(MARKER)? + MARKER.len();
    let end = start + output[start..].find(MARKER)?;
    Some(output[start..end].to_string())
}

fn merge_paths(parts: &[String]) -> String {
    let mut seen = std::collections::HashSet::new();
    parts
        .iter()
        .flat_map(|part| part.split(':'))
        .filter(|dir| !dir.is_empty() && seen.insert(dir.to_string()))
        .collect::<Vec<_>>()
        .join(":")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_the_path_from_between_markers_ignoring_rc_file_noise() {
        let output = format!("Welcome back!\nnvm: using node 22\n{MARKER}/a/bin:/usr/bin{MARKER}");
        assert_eq!(extract_marked(&output).as_deref(), Some("/a/bin:/usr/bin"));
        assert_eq!(extract_marked(&format!("{MARKER}/partial")), None);
    }

    #[test]
    fn merges_in_priority_order_without_duplicates_or_empties() {
        let merged = merge_paths(&[
            "/home/u/.nvm/bin:/usr/bin".to_string(),
            "/usr/bin::/bin".to_string(),
            String::new(),
            "/opt/homebrew/bin".to_string(),
        ]);
        assert_eq!(merged, "/home/u/.nvm/bin:/usr/bin:/bin:/opt/homebrew/bin");
    }

    #[test]
    fn resolves_bare_commands_via_the_given_path_and_paths_directly() {
        let dir = tempfile::tempdir().unwrap();
        let tool = dir.path().join("fake-mcp-tool");
        std::fs::write(&tool, "").unwrap();
        let path = format!("/nonexistent:{}", dir.path().display());

        assert!(resolves_on("fake-mcp-tool", &path));
        assert!(!resolves_on("fake-mcp-tool", "/usr/bin"));
        assert!(resolves_on(tool.to_str().unwrap(), "/usr/bin"));
        assert!(!resolves_on("/definitely/not/here/uvx", &path));
    }

    #[cfg(unix)]
    #[test]
    fn resolved_user_path_keeps_the_system_directories() {
        let path = user_path().expect("unix always resolves a PATH");
        assert!(path.split(':').any(|dir| dir == "/usr/bin"), "{path}");
    }
}
