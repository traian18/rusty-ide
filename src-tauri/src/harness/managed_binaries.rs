//! Native managed-provider runtimes are installed on demand in app-local data.
//! The app ships only pinned package URLs and SHA-512 checksums. Passive
//! resolution never downloads and never falls back to a system CLI.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Emitter, Manager};

/// Node's own platform naming (`darwin`/`win32`/`linux`) -- the vendored
/// npm packages are named with this, not Rust's `std::env::consts::OS`
/// spelling (`macos`/`windows`/`linux`).
fn node_platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "windows") {
        "win32"
    } else {
        "linux"
    }
}

/// Node's own arch naming (`arm64`/`x64`) -- the vendored npm packages are
/// named with this, not Rust's `std::env::consts::ARCH` spelling
/// (`aarch64`/`x86_64`).
fn node_arch() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x64"
    }
}

/// Rust target triple for Codex's own vendored package layout
/// (`vendor/{triple}/bin/codex`) -- ported verbatim from
/// `agent-sidecar/src/services/codexService.ts`'s own
/// `resolveCodexExecutable()` table; a static lookup, not runtime
/// behavior, so there's nothing to keep in sync beyond a new platform.
fn codex_target_triple() -> Option<&'static str> {
    match (node_platform(), node_arch()) {
        ("darwin", "arm64") => Some("aarch64-apple-darwin"),
        ("darwin", "x64") => Some("x86_64-apple-darwin"),
        ("linux", "arm64") => Some("aarch64-unknown-linux-musl"),
        ("linux", "x64") => Some("x86_64-unknown-linux-musl"),
        ("win32", "arm64") => Some("aarch64-pc-windows-msvc"),
        ("win32", "x64") => Some("x86_64-pc-windows-msvc"),
        _ => None,
    }
}

fn exe_name(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

/// `<node_modules>/@openai/codex-{platform}-{arch}/vendor/{triple}/bin/codex`.
pub fn codex_binary_path(node_modules_dir: &Path) -> Option<PathBuf> {
    let triple = codex_target_triple()?;
    let path = node_modules_dir
        .join("@openai")
        .join(format!("codex-{}-{}", node_platform(), node_arch()))
        .join("vendor")
        .join(triple)
        .join("bin")
        .join(exe_name("codex"));
    path.is_file().then_some(path)
}

/// `<node_modules>/@anthropic-ai/claude-agent-sdk-{platform}-{arch}/claude`.
pub fn claude_code_binary_path(node_modules_dir: &Path) -> Option<PathBuf> {
    let path = node_modules_dir
        .join("@anthropic-ai")
        .join(format!(
            "claude-agent-sdk-{}-{}",
            node_platform(),
            node_arch()
        ))
        .join(exe_name("claude"));
    path.is_file().then_some(path)
}

/// `<node_modules>/@github/copilot-{platform}-{arch}/copilot`.
pub fn github_copilot_binary_path(node_modules_dir: &Path) -> Option<PathBuf> {
    let path = node_modules_dir
        .join("@github")
        .join(format!("copilot-{}-{}", node_platform(), node_arch()))
        .join(exe_name("copilot"));
    path.is_file().then_some(path)
}

#[derive(Clone, serde::Deserialize)]
struct Package {
    version: String,
    resolved: String,
    integrity: String,
}

pub fn is_managed_provider(provider: &str) -> bool {
    matches!(provider, "codex" | "claude-code" | "github-copilot")
}

fn package_for(provider: &str) -> Result<(String, Package), String> {
    if !matches!(std::env::consts::ARCH, "aarch64" | "x86_64")
        || !matches!(std::env::consts::OS, "macos" | "linux" | "windows")
    {
        return Err("Managed runtimes are unavailable on this platform".into());
    }
    let platform = node_platform();
    let arch = node_arch();
    let name = match provider {
        "codex" => format!("@openai/codex-{platform}-{arch}"),
        "claude-code" => format!(
            "@anthropic-ai/claude-agent-sdk-{platform}-{arch}{}",
            if cfg!(target_env = "musl") {
                "-musl"
            } else {
                ""
            }
        ),
        "github-copilot" => format!(
            "@github/copilot-{}-{arch}",
            if cfg!(target_env = "musl") {
                "linuxmusl"
            } else {
                platform
            }
        ),
        _ => return Err(format!("Unknown managed provider: {provider}")),
    };
    let packages: std::collections::HashMap<String, Package> =
        serde_json::from_str(include_str!("managed-runtime-packages.json"))
            .map_err(|error| error.to_string())?;
    let package = packages
        .get(&name)
        .cloned()
        .ok_or_else(|| format!("No runtime available for {name}"))?;
    Ok((name, package))
}

fn binary_in_package(provider: &str, root: &Path) -> Option<PathBuf> {
    let path = match provider {
        "codex" => root
            .join("vendor")
            .join(codex_target_triple()?)
            .join("bin")
            .join(exe_name("codex")),
        "claude-code" => root.join(exe_name("claude")),
        "github-copilot" => root.join(exe_name("copilot")),
        _ => return None,
    };
    path.is_file().then_some(path)
}

fn install_dir(app: &AppHandle, provider: &str, package: &Package) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("managed-runtimes")
        .join(provider)
        .join(format!(
            "{}-{}-{}",
            package.version,
            node_platform(),
            node_arch()
        )))
}

/// Purely local lookup: opening settings, checking auth, and quota polling
/// must never install a runtime.
pub fn resolve_managed_binary(app: &AppHandle, provider: &str) -> Option<PathBuf> {
    let (_, package) = package_for(provider).ok()?;
    binary_in_package(provider, &install_dir(app, provider, &package).ok()?)
}

fn verify_archive(bytes: &[u8], integrity: &str) -> Result<(), String> {
    use base64::Engine;
    use sha2::{Digest, Sha512};
    let expected = integrity
        .strip_prefix("sha512-")
        .ok_or("Missing SHA-512 checksum")?;
    let actual = base64::engine::general_purpose::STANDARD.encode(Sha512::digest(bytes));
    if actual != expected {
        return Err("Runtime download failed checksum verification; please retry".into());
    }
    Ok(())
}

fn extract_package(bytes: &[u8], destination: &Path) -> Result<(), String> {
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(bytes));
    let mut total = 0u64;
    for entry in archive.entries().map_err(|error| error.to_string())? {
        let mut entry = entry.map_err(|error| error.to_string())?;
        let path = entry
            .path()
            .map_err(|error| error.to_string())?
            .into_owned();
        let relative = path
            .strip_prefix("package")
            .map_err(|_| "Invalid runtime archive root")?;
        if relative
            .components()
            .any(|part| !matches!(part, std::path::Component::Normal(_)))
        {
            return Err("Unsafe path in runtime archive".into());
        }
        let kind = entry.header().entry_type();
        if !kind.is_file() && !kind.is_dir() {
            return Err("Links and special files are not allowed in runtime archives".into());
        }
        total = total
            .checked_add(entry.size())
            .ok_or("Runtime archive too large")?;
        if total > 2 * 1024 * 1024 * 1024 {
            return Err("Runtime archive too large".into());
        }
        if relative.as_os_str().is_empty() {
            continue;
        }
        let target = destination.join(relative);
        std::fs::create_dir_all(target.parent().ok_or("Invalid runtime path")?)
            .map_err(|error| error.to_string())?;
        entry.unpack(target).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[derive(Clone, serde::Serialize)]
struct RuntimeProgress {
    provider: String,
    phase: &'static str,
    downloaded: u64,
    total: Option<u64>,
    message: Option<String>,
}

// Dropping an aborted download must clear its loading indicator, too.
struct ProgressReporter {
    app: AppHandle,
    progress: RuntimeProgress,
    finished: bool,
}

impl ProgressReporter {
    fn new(app: &AppHandle, provider: &str) -> Self {
        let reporter = Self {
            app: app.clone(),
            progress: RuntimeProgress {
                provider: provider.into(),
                phase: "downloading",
                downloaded: 0,
                total: None,
                message: None,
            },
            finished: false,
        };
        reporter.emit();
        reporter
    }

    fn emit(&self) {
        let _ = self.app.emit("managed-runtime-progress", &self.progress);
    }

    fn finish(&mut self, result: &Result<PathBuf, String>) {
        self.finished = true;
        self.progress.phase = if result.is_ok() { "complete" } else { "failed" };
        self.progress.message = result.as_ref().err().cloned();
        self.emit();
    }
}

impl Drop for ProgressReporter {
    fn drop(&mut self) {
        if !self.finished {
            self.progress.phase = "cancelled";
            self.emit();
        }
    }
}

/// Called only by explicit sign-in or starting a session for this provider.
/// Per-provider locking coalesces concurrent requests. Temporary directories
/// keep cancelled/failed downloads invisible and the final rename is atomic.
pub async fn ensure_managed_binary(app: &AppHandle, provider: &str) -> Result<PathBuf, String> {
    static LOCKS: [tokio::sync::Mutex<()>; 3] = [
        tokio::sync::Mutex::const_new(()),
        tokio::sync::Mutex::const_new(()),
        tokio::sync::Mutex::const_new(()),
    ];
    let index = match provider {
        "codex" => 0,
        "claude-code" => 1,
        "github-copilot" => 2,
        _ => return Err(format!("Unknown managed provider: {provider}")),
    };
    let _guard = LOCKS[index].lock().await;
    if let Some(binary) = resolve_managed_binary(app, provider) {
        return Ok(binary);
    }
    let mut progress = ProgressReporter::new(app, provider);
    let result = download_managed_binary(app, provider, &mut progress).await;
    progress.finish(&result);
    result
}

async fn download_managed_binary(
    app: &AppHandle,
    provider: &str,
    progress: &mut ProgressReporter,
) -> Result<PathBuf, String> {
    let (_, package) = package_for(provider)?;
    if !package.resolved.starts_with("https://registry.npmjs.org/") {
        return Err("Invalid runtime download host".into());
    }
    let destination = install_dir(app, provider, &package)?;
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .timeout(std::time::Duration::from_secs(10 * 60))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| error.to_string())?;
    let mut response = client.get(&package.resolved).send().await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| format!("Could not download {provider} runtime: {error}. Check your connection and retry sign-in."))?;
    progress.progress.total = response.content_length().filter(|total| *total > 0);
    progress.emit();
    let mut last_update = std::time::Instant::now();
    const MAX_DOWNLOAD: usize = 512 * 1024 * 1024;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        if bytes.len().saturating_add(chunk.len()) > MAX_DOWNLOAD {
            return Err("Runtime download too large".into());
        }
        bytes.extend_from_slice(&chunk);
        progress.progress.downloaded = bytes.len() as u64;
        if last_update.elapsed() >= std::time::Duration::from_millis(100) {
            progress.emit();
            last_update = std::time::Instant::now();
        }
    }
    progress.progress.phase = "installing";
    progress.emit();
    let provider = provider.to_string();
    // Keep extraction and publication in the awaited task. If login is
    // cancelled, a completed verified install may still be reused later.
    tokio::task::spawn_blocking(move || {
        verify_archive(&bytes, &package.integrity)?;
        let parent = destination.parent().ok_or("Invalid install directory")?;
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        let staging = tempfile::tempdir_in(parent).map_err(|error| error.to_string())?;
        extract_package(&bytes, staging.path())?;
        binary_in_package(&provider, staging.path())
            .ok_or("Runtime archive is missing its executable")?;
        if destination.exists() {
            // Another app instance may have completed this same version.
            if let Some(binary) = binary_in_package(&provider, &destination) {
                return Ok(binary);
            }
            std::fs::remove_dir_all(&destination).map_err(|error| error.to_string())?;
        }
        match std::fs::rename(staging.path(), &destination) {
            Ok(()) => {}
            Err(error) if binary_in_package(&provider, &destination).is_none() => {
                return Err(error.to_string())
            }
            Err(_) => {} // Another process published the complete package.
        }
        binary_in_package(&provider, &destination)
            .ok_or_else(|| "Runtime installation failed".into())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn archive_with(path: &str, kind: tar::EntryType) -> Vec<u8> {
        let encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        let mut archive = tar::Builder::new(encoder);
        let mut header = tar::Header::new_gnu();
        header.set_entry_type(kind);
        header.set_mode(0o755);
        header.set_size(0);
        header.set_cksum();
        archive
            .append_data(&mut header, path, std::io::empty())
            .unwrap();
        archive.into_inner().unwrap().finish().unwrap()
    }

    #[test]
    fn validates_checksums_and_rejects_corruption() {
        use base64::Engine;
        use sha2::{Digest, Sha512};
        let bytes = b"runtime";
        let integrity = format!(
            "sha512-{}",
            base64::engine::general_purpose::STANDARD.encode(Sha512::digest(bytes))
        );
        assert!(verify_archive(bytes, &integrity).is_ok());
        assert!(verify_archive(b"corrupt", &integrity).is_err());
        assert!(verify_archive(bytes, "sha1-ignored").is_err());
    }

    #[test]
    fn extracts_package_and_preserves_executable_permissions() {
        let dir = tempfile::tempdir().unwrap();
        extract_package(
            &archive_with("package/claude", tar::EntryType::Regular),
            dir.path(),
        )
        .unwrap();
        assert!(dir.path().join("claude").is_file());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_ne!(
                fs::metadata(dir.path().join("claude"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o111,
                0
            );
        }
    }

    #[test]
    fn rejects_links_wrong_roots_and_truncated_archives() {
        for bytes in [
            archive_with("package/link", tar::EntryType::Symlink),
            archive_with("outside/file", tar::EntryType::Regular),
            b"incomplete".to_vec(),
        ] {
            let dir = tempfile::tempdir().unwrap();
            assert!(extract_package(&bytes, dir.path()).is_err());
        }
    }

    #[test]
    fn manifest_matches_locked_native_packages() {
        let manifest: serde_json::Value =
            serde_json::from_str(include_str!("managed-runtime-packages.json")).unwrap();
        let lock: serde_json::Value =
            serde_json::from_str(include_str!("../../../vendor-cli/package-lock.json")).unwrap();
        for (name, package) in manifest.as_object().unwrap() {
            let locked = &lock["packages"][format!("node_modules/{name}")];
            for field in ["version", "resolved", "integrity"] {
                assert_eq!(package[field], locked[field], "{name}: {field}");
            }
        }
        for provider in ["codex", "claude-code", "github-copilot"] {
            assert!(package_for(provider).is_ok());
        }
        assert!(package_for("openai").is_err());
    }

    #[tokio::test]
    #[ignore = "downloads native packages; run explicitly to smoke-test upstream artifacts"]
    async fn downloaded_runtimes_pass_integrity_and_execute() {
        for provider in ["codex", "claude-code", "github-copilot"] {
            let (_, package) = package_for(provider).unwrap();
            let bytes = reqwest::get(&package.resolved)
                .await
                .unwrap()
                .error_for_status()
                .unwrap()
                .bytes()
                .await
                .unwrap();
            verify_archive(&bytes, &package.integrity).unwrap();
            let dir = tempfile::tempdir().unwrap();
            extract_package(&bytes, dir.path()).unwrap();
            let binary = binary_in_package(provider, dir.path()).unwrap();
            let output = tokio::time::timeout(
                std::time::Duration::from_secs(30),
                tokio::process::Command::new(binary)
                    .arg("--version")
                    .kill_on_drop(true)
                    .output(),
            )
            .await
            .unwrap()
            .unwrap();
            assert!(output.status.success(), "{provider}: {:?}", output);
            println!("{provider}: {}", String::from_utf8_lossy(&output.stdout));
        }
    }

    #[test]
    fn default_bundle_has_no_managed_runtime_resources_or_build_step() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        assert!(config["bundle"]["resources"].is_null());
        assert_eq!(config["build"]["beforeBuildCommand"], "npm run build");
    }

    #[test]
    fn an_installed_provider_does_not_make_other_providers_available() {
        let dir = tempfile::tempdir().unwrap();
        assert!(binary_in_package("claude-code", dir.path()).is_none());
        touch(&dir.path().join(exe_name("claude")));
        assert!(binary_in_package("claude-code", dir.path()).is_some());
        assert!(binary_in_package("codex", dir.path()).is_none());
        assert!(binary_in_package("github-copilot", dir.path()).is_none());
    }

    fn touch(path: &Path) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"").unwrap();
    }

    #[test]
    fn resolves_the_codex_binary_when_the_vendored_package_is_staged() {
        let dir = tempfile::tempdir().unwrap();
        let triple = codex_target_triple().expect(
            "this platform/arch must be a supported Codex target for the test to be meaningful",
        );
        let expected = dir
            .path()
            .join("@openai")
            .join(format!("codex-{}-{}", node_platform(), node_arch()))
            .join("vendor")
            .join(triple)
            .join("bin")
            .join(exe_name("codex"));
        touch(&expected);

        assert_eq!(codex_binary_path(dir.path()), Some(expected));
    }

    #[test]
    fn returns_none_when_the_codex_package_is_not_staged() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(codex_binary_path(dir.path()), None);
    }

    #[test]
    fn resolves_the_claude_code_binary_when_the_vendored_package_is_staged() {
        let dir = tempfile::tempdir().unwrap();
        let expected = dir
            .path()
            .join("@anthropic-ai")
            .join(format!(
                "claude-agent-sdk-{}-{}",
                node_platform(),
                node_arch()
            ))
            .join(exe_name("claude"));
        touch(&expected);

        assert_eq!(claude_code_binary_path(dir.path()), Some(expected));
    }

    #[test]
    fn resolves_the_github_copilot_binary_when_the_vendored_package_is_staged() {
        let dir = tempfile::tempdir().unwrap();
        let expected = dir
            .path()
            .join("@github")
            .join(format!("copilot-{}-{}", node_platform(), node_arch()))
            .join(exe_name("copilot"));
        touch(&expected);

        assert_eq!(github_copilot_binary_path(dir.path()), Some(expected));
    }

    #[test]
    fn a_present_but_empty_node_modules_dir_resolves_nothing_for_any_provider() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(claude_code_binary_path(dir.path()), None);
        assert_eq!(github_copilot_binary_path(dir.path()), None);
    }
}
