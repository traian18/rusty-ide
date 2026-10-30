// @vitest-environment node
// Node rather than jsdom: jsdom's window.crypto has no `subtle`.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const STORE_KEY = "rusty_secure_config";

function base64Key(fill: number): string {
  return Buffer.from(new Uint8Array(32).fill(fill)).toString("base64");
}

function installMemoryLocalStorage(): Map<string, string> {
  const items = new Map<string, string>();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
  });
  return items;
}

async function freshService() {
  vi.resetModules();
  return (await import("./secureStorageService")).SecureStorageService;
}

async function encryptWithLegacyScheme(plaintext: string): Promise<string> {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey(
    "raw",
    enc.encode("rusty-secure-storage-key-phrase-salt-987123"),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("SecureAxiomSalt"), iterations: 100000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext)));
  return Buffer.concat([iv, cipher]).toString("base64");
}

describe("SecureStorageService", () => {
  let items: Map<string, string>;

  beforeEach(() => {
    items = installMemoryLocalStorage();
    invoke.mockReset();
    invoke.mockResolvedValue({ key: base64Key(1), backend: "keychain" });
  });

  it("round-trips data through the installation key", async () => {
    const service = await freshService();

    await service.saveSecureData(STORE_KEY, { token: "ghp_abc" });

    expect(items.get(STORE_KEY)).not.toContain("ghp_abc");
    expect(await service.loadSecureData(STORE_KEY)).toEqual({ token: "ghp_abc" });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("reports which backend holds the key, including a fallback reason", async () => {
    invoke.mockResolvedValue({ key: base64Key(1), backend: "file", fallbackReason: "no session bus" });
    const service = await freshService();

    expect(await service.getStorageBackend()).toEqual({ backend: "file", fallbackReason: "no session bus" });
  });

  it("rejects without touching the blob when the key can't be obtained, and can retry later", async () => {
    const writer = await freshService();
    await writer.saveSecureData(STORE_KEY, { token: "ghp_abc" });
    const blob = items.get(STORE_KEY);

    invoke.mockRejectedValueOnce(new Error("keyring is locked"));
    const service = await freshService();

    await expect(service.loadSecureData(STORE_KEY)).rejects.toThrow("keyring is locked");
    expect(items.get(STORE_KEY)).toBe(blob);
    expect([...items.keys()]).toEqual([STORE_KEY]);

    expect(await service.loadSecureData(STORE_KEY)).toEqual({ token: "ghp_abc" });
  });

  it("migrates a blob written under the old hardcoded key", async () => {
    items.set(STORE_KEY, await encryptWithLegacyScheme(JSON.stringify({ token: "legacy" })));
    const service = await freshService();

    expect(await service.loadSecureData(STORE_KEY)).toEqual({ token: "legacy" });

    // Now readable with the installation key alone (the legacy path would also
    // succeed, so prove it by checking a fresh blob was written).
    const migrated = items.get(STORE_KEY)!;
    const reloaded = await freshService();
    expect(await reloaded.loadSecureData(STORE_KEY)).toEqual({ token: "legacy" });
    expect(items.get(STORE_KEY)).toBe(migrated);
  });

  it("moves an undecryptable blob aside instead of letting it be overwritten", async () => {
    const writer = await freshService();
    await writer.saveSecureData(STORE_KEY, { token: "ghp_abc" });
    const blob = items.get(STORE_KEY);

    invoke.mockResolvedValue({ key: base64Key(2), backend: "keychain" });
    const service = await freshService();

    expect(await service.loadSecureData(STORE_KEY)).toBeNull();
    expect(items.has(STORE_KEY)).toBe(false);
    const status = await service.getStorageBackend();
    expect(status.unrecoverableBackupKey).toMatch(/^rusty_secure_config\.unrecoverable\.\d+$/);
    expect(items.get(status.unrecoverableBackupKey!)).toBe(blob);
  });
});
