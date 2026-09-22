const PASSWORD = "rusty-secure-storage-key-phrase-salt-987123";
const SALT = new Uint8Array([83, 101, 99, 117, 114, 101, 65, 120, 105, 111, 109, 83, 97, 108, 116]); // "SecureRustySalt"

async function getKey(): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(PASSWORD),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: SALT,
      iterations: 100000,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export const SecureStorageService = {
  async encrypt(text: string): Promise<string> {
    try {
      const key = await getKey();
      const enc = new TextEncoder();
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        enc.encode(text)
      );
      
      const combined = new Uint8Array(iv.length + encrypted.byteLength);
      combined.set(iv, 0);
      combined.set(new Uint8Array(encrypted), iv.length);
      
      let binary = "";
      const len = combined.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(combined[i]);
      }
      return window.btoa(binary);
    } catch (e) {
      console.error("Encryption failed:", e);
      throw e;
    }
  },

  async decrypt(base64: string): Promise<string> {
    try {
      const key = await getKey();
      const binaryString = window.atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      const iv = bytes.slice(0, 12);
      const encryptedData = bytes.slice(12);
      
      const decrypted = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        encryptedData
      );
      
      const dec = new TextDecoder();
      return dec.decode(decrypted);
    } catch (e) {
      console.error("Decryption failed:", e);
      throw e;
    }
  },

  async saveSecureData(key: string, data: any): Promise<void> {
    const jsonStr = JSON.stringify(data);
    const encrypted = await this.encrypt(jsonStr);
    localStorage.setItem(key, encrypted);
  },

  async loadSecureData<T>(key: string): Promise<T | null> {
    const encrypted = localStorage.getItem(key);
    if (!encrypted) return null;
    try {
      const decrypted = await this.decrypt(encrypted);
      return JSON.parse(decrypted) as T;
    } catch (e) {
      console.error(`Failed to load or decrypt secure data for key ${key}:`, e);
      return null;
    }
  }
};
