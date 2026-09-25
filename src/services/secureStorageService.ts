// ============================================================
// secureStorageService.ts — AES-GCM encryption for the `rusty_secure_config`
// localStorage blob (provider API keys, and the GitHub/Atlassian/generic
// MCP server tokens configured under Settings > Integrations).
//
// The AES key comes from `secure_key.rs`'s `get_storage_key` Tauri
// command: a random 256-bit key held in the OS keychain (macOS Keychain /
// Linux Secret Service), or in an owner-only app-data file where no keychain
// is available -- never shipped in the frontend bundle. Earlier versions
// derived the key from a password + salt pair hardcoded in this file, which
// meant the "encryption" was reversible by anyone who read the JS source;
// getLegacyKey below exists only to migrate data written under that scheme.
//
// Failure contract for loadSecureData, which the store's save guard
// (createIntegrationSlice's secureConfigLoaded) depends on:
// - the key can't be obtained at all (locked keychain): throw, so nothing
//   gets saved over the blob this session;
// - the key is obtained but can't decrypt the blob (keychain entry reset):
//   move the blob aside under a backup key and start fresh -- never overwrite
//   it silently.
// ============================================================

import { invoke } from "@tauri-apps/api/core";

const LEGACY_PASSWORD = "rusty-secure-storage-key-phrase-salt-987123";
const LEGACY_SALT = new Uint8Array([83, 101, 99, 117, 114, 101, 65, 120, 105, 111, 109, 83, 97, 108, 116]); // "SecureAxiomSalt"

export type StorageKeyBackend = "keychain" | "file";

export interface StorageBackendStatus {
  backend: StorageKeyBackend;
  /** Set when the keychain was expected but unavailable, so the file was used. */
  fallbackReason?: string;
  /** localStorage key an undecryptable blob was moved to during this session. */
  unrecoverableBackupKey?: string;
}

interface StorageKeyResponse {
  key: string;
  backend: StorageKeyBackend;
  fallbackReason?: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return window.btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

interface InstallationKey {
  cryptoKey: CryptoKey;
  status: StorageBackendStatus;
}

let installationKeyPromise: Promise<InstallationKey> | null = null;

async function deriveInstallationKey(): Promise<InstallationKey> {
  const response = await invoke<StorageKeyResponse>("get_storage_key");
  const cryptoKey = await window.crypto.subtle.importKey(
    "raw",
    base64ToBytes(response.key),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
  return { cryptoKey, status: { backend: response.backend, fallbackReason: response.fallbackReason } };
}

function getInstallationKey(): Promise<InstallationKey> {
  if (!installationKeyPromise) {
    // Forget a failure so a later call (e.g. after the user unlocks the
    // keyring) can retry instead of being stuck on the rejected promise.
    installationKeyPromise = deriveInstallationKey().catch((error) => {
      installationKeyPromise = null;
      throw error;
    });
  }
  return installationKeyPromise;
}

async function getLegacyKey(): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(LEGACY_PASSWORD),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return window.crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: LEGACY_SALT, iterations: 100000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
}

async function encryptWithKey(text: string, key: CryptoKey): Promise<string> {
  const enc = new TextEncoder();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(text));

  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  return bytesToBase64(combined);
}

async function decryptWithKey(base64: string, key: CryptoKey): Promise<string> {
  const combined = base64ToBytes(base64);
  const iv = combined.slice(0, 12);
  const encryptedData = combined.slice(12);
  const decrypted = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encryptedData);
  return new TextDecoder().decode(decrypted);
}

let unrecoverableBackupKey: string | undefined;

export const SecureStorageService = {
  async getStorageBackend(): Promise<StorageBackendStatus> {
    const { status } = await getInstallationKey();
    return { ...status, unrecoverableBackupKey };
  },

  async saveSecureData(key: string, data: unknown): Promise<void> {
    const { cryptoKey } = await getInstallationKey();
    localStorage.setItem(key, await encryptWithKey(JSON.stringify(data), cryptoKey));
  },

  async loadSecureData<T>(key: string): Promise<T | null> {
    const encrypted = localStorage.getItem(key);
    if (!encrypted) return null;

    // Deliberately outside any try: a key we can't obtain must reject.
    const { cryptoKey } = await getInstallationKey();

    try {
      return JSON.parse(await decryptWithKey(encrypted, cryptoKey)) as T;
    } catch {
      // May predate the per-installation key: try the old hardcoded one.
    }

    try {
      const parsed = JSON.parse(await decryptWithKey(encrypted, await getLegacyKey())) as T;
      await this.saveSecureData(key, parsed);
      return parsed;
    } catch {
      // Neither key works, e.g. the keychain entry was deleted or reset.
    }

    const backupKey = `${key}.unrecoverable.${Date.now()}`;
    localStorage.setItem(backupKey, encrypted);
    localStorage.removeItem(key);
    unrecoverableBackupKey = backupKey;
    console.error(
      `Saved secure data under "${key}" could not be decrypted with the current storage key; ` +
        `it was moved to "${backupKey}" and settings start fresh.`
    );
    return null;
  },
};
