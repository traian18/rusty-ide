// OS credential-store access for the storage master key: macOS Keychain
// Services, or the Secret Service API on Linux (GNOME Keyring, KWallet).
// Deliberately free of tauri types so it can be type-checked for Linux in
// isolation from a macOS host.

use std::sync::Arc;

use keyring_core::{CredentialStore, Entry, Error};

pub struct KeychainStore {
    entry: Entry,
}

impl KeychainStore {
    /// Fails when the platform store can't be reached at all -- e.g. no D-Bus
    /// session bus on a headless Linux box.
    pub fn open(service: &str, account: &str) -> Result<Self, String> {
        let entry = platform_store()?
            .build(service, account, None)
            .map_err(|e| format!("could not open keychain entry: {e}"))?;
        Ok(Self { entry })
    }

    pub fn read(&self) -> Result<Option<Vec<u8>>, String> {
        match self.entry.get_secret() {
            Ok(secret) => Ok(Some(secret)),
            Err(Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("could not read keychain: {e}")),
        }
    }

    pub fn write(&self, secret: &[u8]) -> Result<(), String> {
        self.entry
            .set_secret(secret)
            .map_err(|e| format!("could not write keychain: {e}"))
    }
}

#[cfg(target_os = "macos")]
fn platform_store() -> Result<Arc<CredentialStore>, String> {
    let store: Arc<CredentialStore> = apple_native_keyring_store::keychain::Store::new()
        .map_err(|e| format!("macOS Keychain unavailable: {e}"))?;
    Ok(store)
}

#[cfg(target_os = "linux")]
fn platform_store() -> Result<Arc<CredentialStore>, String> {
    let store: Arc<CredentialStore> = zbus_secret_service_keyring_store::Store::new()
        .map_err(|e| format!("Secret Service unavailable: {e}"))?;
    Ok(store)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "touches the real OS credential store; run with --ignored"]
    fn round_trips_a_binary_secret_through_the_real_store() {
        let service = format!("com.rusty.ide.test.{}", std::process::id());
        let store = KeychainStore::open(&service, "round-trip").unwrap();
        assert_eq!(store.read().unwrap(), None);

        let secret: Vec<u8> = (0..32).collect();
        store.write(&secret).unwrap();
        let read_back = store.read();
        store.entry.delete_credential().unwrap();

        assert_eq!(read_back.unwrap(), Some(secret));
    }
}
