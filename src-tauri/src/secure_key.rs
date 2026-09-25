// ============================================================
// secure_key.rs — the master key for `services/secureStorageService.ts`'s
// AES-GCM encryption of `rusty_secure_config` (provider API keys and the
// GitHub/Atlassian/generic MCP tokens). The frontend owns encryption and
// the localStorage blob; this module only decides where the key lives.
//
// Where the key lives:
// - macOS release builds and Linux: the OS credential store (Keychain
//   Services / Secret Service), via `keychain.rs`.
// - Everywhere else, and whenever the credential store is unreachable (e.g.
//   a Linux session with no GNOME Keyring/KWallet running): a 32-byte file
//   in the app-local-data dir with owner-only permissions.
// - macOS debug builds: always the file. Keychain ACLs are tied to the code
//   signature, and every dev rebuild is re-signed ad hoc, so the keychain
//   would prompt for access after each rebuild.
//
// An existing key file is moved into the credential store on first run,
// so data it already encrypted stays readable. Once moved, a `.keychain`
// marker file is written: if the credential store later becomes
// unreachable (locked keyring, dismissed prompt), `get_storage_key` fails
// rather than generating a fresh key, which would silently make every
// saved secret unreadable.
// ============================================================

#[cfg(any(target_os = "macos", target_os = "linux"))]
mod keychain;

use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::Engine;
use rand::RngCore;
use serde::Serialize;

const KEY_LEN: usize = 32;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum KeyBackend {
    Keychain,
    File,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StorageKey {
    key: String,
    backend: KeyBackend,
    /// Why the credential store wasn't used when this build expected to use it.
    #[serde(skip_serializing_if = "Option::is_none")]
    fallback_reason: Option<String>,
}

trait KeychainLike {
    fn read(&self) -> Result<Option<Vec<u8>>, String>;
    fn write(&self, key: &[u8]) -> Result<(), String>;
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
impl KeychainLike for keychain::KeychainStore {
    fn read(&self) -> Result<Option<Vec<u8>>, String> {
        keychain::KeychainStore::read(self)
    }
    fn write(&self, key: &[u8]) -> Result<(), String> {
        keychain::KeychainStore::write(self, key)
    }
}

struct FileStore {
    path: PathBuf,
}

impl FileStore {
    fn read(&self) -> Result<Option<Vec<u8>>, String> {
        match fs::read(&self.path) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
            Err(e) => Err(format!("could not read {}: {e}", self.path.display())),
        }
    }

    fn read_valid(&self) -> Result<Option<Vec<u8>>, String> {
        Ok(self.read()?.filter(|key| key.len() == KEY_LEN))
    }

    fn write(&self, key: &[u8]) -> Result<(), String> {
        write_private(&self.path, key).map_err(|e| format!("could not write {}: {e}", self.path.display()))
    }

    /// Overwrites before unlinking. Best effort only: SSD wear levelling and
    /// copy-on-write filesystems can keep the old blocks around.
    fn delete(&self) -> Result<(), String> {
        if !self.path.exists() {
            return Ok(());
        }
        let _ = write_private(&self.path, &[0u8; KEY_LEN]);
        fs::remove_file(&self.path).map_err(|e| format!("could not remove {}: {e}", self.path.display()))
    }
}

fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        options.mode(0o600);
        let mut file = options.open(path)?;
        // `mode` only applies on creation; tighten a pre-existing file too.
        file.set_permissions(fs::Permissions::from_mode(0o600))?;
        file.write_all(bytes)
    }
    #[cfg(not(unix))]
    {
        options.open(path)?.write_all(bytes)
    }
}

fn generate_key() -> Vec<u8> {
    let mut key = vec![0u8; KEY_LEN];
    rand::rngs::OsRng.fill_bytes(&mut key);
    key
}

#[derive(Debug)]
struct Resolved {
    key: Vec<u8>,
    backend: KeyBackend,
    fallback_reason: Option<String>,
}

/// `keychain` is `None` when this build never uses the credential store,
/// and `Some(Err(_))` when it should but the store couldn't be opened.
fn resolve(
    keychain: Option<Result<&dyn KeychainLike, String>>,
    file: &FileStore,
    marker: &Path,
) -> Result<Resolved, String> {
    let keychain = match keychain {
        None => return from_file(file, None, None),
        Some(Err(reason)) => return fall_back_to_file(file, marker, reason),
        Some(Ok(keychain)) => keychain,
    };

    match keychain.read() {
        Ok(Some(key)) if key.len() == KEY_LEN => {
            retire_file(file, marker);
            return Ok(Resolved { key, backend: KeyBackend::Keychain, fallback_reason: None });
        }
        Ok(_) => {}
        Err(reason) => return fall_back_to_file(file, marker, reason),
    }

    // The store is reachable but holds no usable key: move the file's key in
    // (so data it already encrypted stays readable), or start fresh.
    let key = file.read_valid()?.unwrap_or_else(generate_key);
    let stored = keychain.write(&key).and_then(|()| match keychain.read()? {
        Some(read_back) if read_back == key => Ok(()),
        _ => Err("keychain read-back did not match the key just written".to_string()),
    });
    match stored {
        Ok(()) => {
            retire_file(file, marker);
            Ok(Resolved { key, backend: KeyBackend::Keychain, fallback_reason: None })
        }
        Err(reason) => from_file(file, Some(key), Some(reason)),
    }
}

/// Only deletes the file once the marker is down, so a later keychain outage
/// can always be told apart from "never migrated".
fn retire_file(file: &FileStore, marker: &Path) {
    if write_private(marker, b"keychain\n").is_ok() {
        if let Err(e) = file.delete() {
            eprintln!("[secure_key] key is in the keychain but the old key file could not be removed: {e}");
        }
    }
}

fn fall_back_to_file(file: &FileStore, marker: &Path, reason: String) -> Result<Resolved, String> {
    if marker.exists() && file.read_valid()?.is_none() {
        return Err(format!(
            "{reason}. The storage key was moved into the OS keychain earlier, so a new key can't be \
             substituted without making saved secrets unreadable. Unlock the keychain and restart Rusty."
        ));
    }
    from_file(file, None, Some(reason))
}

fn from_file(file: &FileStore, candidate: Option<Vec<u8>>, reason: Option<String>) -> Result<Resolved, String> {
    let key = match file.read_valid()? {
        Some(existing) => existing,
        None => {
            let key = candidate.unwrap_or_else(generate_key);
            file.write(&key)?;
            key
        }
    };
    Ok(Resolved { key, backend: KeyBackend::File, fallback_reason: reason })
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn open_keychain(identifier: &str) -> Option<Result<Box<dyn KeychainLike>, String>> {
    if cfg!(all(target_os = "macos", debug_assertions)) {
        return None;
    }
    let service = if cfg!(debug_assertions) { format!("{identifier}.dev") } else { identifier.to_string() };
    Some(
        keychain::KeychainStore::open(&service, "secure-storage-master-key")
            .map(|store| Box::new(store) as Box<dyn KeychainLike>),
    )
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn open_keychain(_identifier: &str) -> Option<Result<Box<dyn KeychainLike>, String>> {
    None
}

fn resolve_in(dir: &Path, identifier: &str) -> Result<Resolved, String> {
    // Dev and release builds have separate webview origins, hence separate
    // localStorage blobs -- they get separate keys too, so migrating one
    // build's key into the keychain never strands the other build's data.
    let stem = if cfg!(debug_assertions) { "secure_storage.dev" } else { "secure_storage" };
    let file = FileStore { path: dir.join(format!("{stem}.key")) };
    let marker = dir.join(format!("{stem}.keychain"));

    if cfg!(debug_assertions) && !file.path.exists() {
        // Builds from before the dev/release split shared secure_storage.key.
        let _ = fs::copy(dir.join("secure_storage.key"), &file.path);
    }

    let opened = open_keychain(identifier);
    let keychain = opened.as_ref().map(|result| result.as_ref().map(|store| store.as_ref()).map_err(Clone::clone));
    resolve(keychain, &file, &marker)
}

/// Resolved once per process: credential-store access can block on an
/// unlock or permission prompt, and must never race itself into two keys.
static RESOLVED: Mutex<Option<StorageKey>> = Mutex::new(None);

#[tauri::command]
pub async fn get_storage_key(app: tauri::AppHandle) -> Result<StorageKey, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("could not resolve app local data dir: {e}"))?;
    let identifier = app.config().identifier.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut cached = RESOLVED.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(hit) = cached.as_ref() {
            return Ok(hit.clone());
        }
        fs::create_dir_all(&dir).map_err(|e| format!("could not create app local data dir: {e}"))?;
        let resolved = resolve_in(&dir, &identifier)?;
        let key = StorageKey {
            key: base64::engine::general_purpose::STANDARD.encode(&resolved.key),
            backend: resolved.backend,
            fallback_reason: resolved.fallback_reason,
        };
        *cached = Some(key.clone());
        Ok(key)
    })
    .await
    .map_err(|e| format!("storage key task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[derive(Default)]
    struct FakeKeychain {
        stored: RefCell<Option<Vec<u8>>>,
        fail_read: bool,
        fail_write: bool,
        garble_read_back: bool,
    }

    impl KeychainLike for FakeKeychain {
        fn read(&self) -> Result<Option<Vec<u8>>, String> {
            if self.fail_read {
                return Err("keyring is locked".to_string());
            }
            Ok(self.stored.borrow().clone())
        }
        fn write(&self, key: &[u8]) -> Result<(), String> {
            if self.fail_write {
                return Err("write denied".to_string());
            }
            let mut value = key.to_vec();
            if self.garble_read_back {
                value[0] ^= 0xff;
            }
            *self.stored.borrow_mut() = Some(value);
            Ok(())
        }
    }

    struct Fixture {
        _dir: tempfile::TempDir,
        file: FileStore,
        marker: PathBuf,
    }

    fn fixture() -> Fixture {
        let dir = tempfile::tempdir().unwrap();
        let file = FileStore { path: dir.path().join("secure_storage.key") };
        let marker = dir.path().join("secure_storage.keychain");
        Fixture { _dir: dir, file, marker }
    }

    fn some(keychain: &FakeKeychain) -> Option<Result<&dyn KeychainLike, String>> {
        Some(Ok(keychain as &dyn KeychainLike))
    }

    #[test]
    fn uses_the_keychain_key_and_retires_a_leftover_file() {
        let f = fixture();
        let key = generate_key();
        f.file.write(&key).unwrap();
        let keychain = FakeKeychain { stored: RefCell::new(Some(key.clone())), ..Default::default() };

        let resolved = resolve(some(&keychain), &f.file, &f.marker).unwrap();

        assert_eq!(resolved.key, key);
        assert_eq!(resolved.backend, KeyBackend::Keychain);
        assert!(!f.file.path.exists());
        assert!(f.marker.exists());
    }

    #[test]
    fn moves_an_existing_file_key_into_an_empty_keychain_unchanged() {
        let f = fixture();
        let key = generate_key();
        f.file.write(&key).unwrap();
        let keychain = FakeKeychain::default();

        let resolved = resolve(some(&keychain), &f.file, &f.marker).unwrap();

        assert_eq!(resolved.key, key, "existing encrypted data must stay decryptable");
        assert_eq!(keychain.stored.borrow().as_deref(), Some(key.as_slice()));
        assert!(!f.file.path.exists());
        assert!(f.marker.exists());
    }

    #[test]
    fn generates_a_fresh_key_straight_into_the_keychain_on_first_run() {
        let f = fixture();
        let keychain = FakeKeychain::default();

        let resolved = resolve(some(&keychain), &f.file, &f.marker).unwrap();

        assert_eq!(resolved.key.len(), KEY_LEN);
        assert_eq!(resolved.backend, KeyBackend::Keychain);
        assert!(!f.file.path.exists());
    }

    #[test]
    fn replaces_a_malformed_keychain_value_with_the_file_key() {
        let f = fixture();
        let key = generate_key();
        f.file.write(&key).unwrap();
        let keychain = FakeKeychain { stored: RefCell::new(Some(vec![1, 2, 3])), ..Default::default() };

        let resolved = resolve(some(&keychain), &f.file, &f.marker).unwrap();

        assert_eq!(resolved.key, key);
        assert_eq!(resolved.backend, KeyBackend::Keychain);
    }

    #[test]
    fn falls_back_to_the_file_when_the_store_cannot_be_opened() {
        let f = fixture();

        let resolved = resolve(Some(Err("no session bus".to_string())), &f.file, &f.marker).unwrap();

        assert_eq!(resolved.backend, KeyBackend::File);
        assert_eq!(resolved.fallback_reason.as_deref(), Some("no session bus"));
        assert_eq!(f.file.read_valid().unwrap(), Some(resolved.key));
    }

    #[test]
    fn keeps_the_file_and_same_key_when_the_keychain_write_fails() {
        let f = fixture();
        let keychain = FakeKeychain { fail_write: true, ..Default::default() };

        let resolved = resolve(some(&keychain), &f.file, &f.marker).unwrap();

        assert_eq!(resolved.backend, KeyBackend::File);
        assert_eq!(f.file.read_valid().unwrap(), Some(resolved.key));
        assert!(!f.marker.exists());
    }

    #[test]
    fn never_deletes_the_file_when_the_read_back_does_not_match() {
        let f = fixture();
        let key = generate_key();
        f.file.write(&key).unwrap();
        let keychain = FakeKeychain { garble_read_back: true, ..Default::default() };

        let resolved = resolve(some(&keychain), &f.file, &f.marker).unwrap();

        assert_eq!(resolved.key, key);
        assert_eq!(resolved.backend, KeyBackend::File);
        assert!(f.file.path.exists());
        assert!(!f.marker.exists());
    }

    #[test]
    fn refuses_to_invent_a_key_when_an_already_migrated_keychain_is_unreachable() {
        let f = fixture();
        write_private(&f.marker, b"keychain\n").unwrap();
        let keychain = FakeKeychain { fail_read: true, ..Default::default() };

        let error = resolve(some(&keychain), &f.file, &f.marker).unwrap_err();

        assert!(error.contains("keyring is locked"));
        assert!(!f.file.path.exists(), "no replacement key may be written");
    }

    #[test]
    fn an_unreachable_migrated_keychain_can_still_use_a_surviving_file_key() {
        let f = fixture();
        write_private(&f.marker, b"keychain\n").unwrap();
        let key = generate_key();
        f.file.write(&key).unwrap();
        let keychain = FakeKeychain { fail_read: true, ..Default::default() };

        let resolved = resolve(some(&keychain), &f.file, &f.marker).unwrap();

        assert_eq!(resolved.key, key);
        assert_eq!(resolved.backend, KeyBackend::File);
    }

    #[test]
    fn builds_without_a_keychain_use_the_file_with_no_fallback_warning() {
        let f = fixture();

        let first = resolve(None, &f.file, &f.marker).unwrap();
        let second = resolve(None, &f.file, &f.marker).unwrap();

        assert_eq!(first.backend, KeyBackend::File);
        assert!(first.fallback_reason.is_none());
        assert_eq!(first.key, second.key);
    }

    #[cfg(unix)]
    #[test]
    fn key_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let f = fixture();
        f.file.write(&generate_key()).unwrap();
        let mode = fs::metadata(&f.file.path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}
