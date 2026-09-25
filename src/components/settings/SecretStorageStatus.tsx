import React, { useEffect, useState } from "react";
import { HardDrive, ShieldAlert, ShieldCheck } from "lucide-react";
import {
  SecureStorageService,
  type StorageBackendStatus,
} from "../../services/secureStorageService";
import styles from "./SecretStorageStatus.module.css";

type Tone = "ok" | "neutral" | "warn";

function describe(status: StorageBackendStatus): { tone: Tone; text: string } {
  if (status.unrecoverableBackupKey) {
    return {
      tone: "warn",
      text:
        "Previously saved secrets couldn't be decrypted with the current key (was the keychain entry reset?). " +
        `The old data was kept as localStorage["${status.unrecoverableBackupKey}"]; re-enter your tokens.`,
    };
  }
  if (status.backend === "keychain") {
    return { tone: "ok", text: "Secrets are encrypted with a key held in the OS keychain." };
  }
  if (status.fallbackReason) {
    return {
      tone: "warn",
      text:
        "OS keychain unavailable, so the encryption key is stored in an owner-only app data file instead. " +
        `(${status.fallbackReason})`,
    };
  }
  return { tone: "neutral", text: "Secrets are encrypted with a key stored in an owner-only app data file." };
}

const ICONS: Record<Tone, React.ComponentType<{ size?: number; className?: string }>> = {
  ok: ShieldCheck,
  neutral: HardDrive,
  warn: ShieldAlert,
};

export const SecretStorageStatus: React.FC = () => {
  const [status, setStatus] = useState<StorageBackendStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    SecureStorageService.getStorageBackend().then(
      (result) => live && setStatus(result),
      (reason: unknown) => live && setError(reason instanceof Error ? reason.message : String(reason))
    );
    return () => {
      live = false;
    };
  }, []);

  if (!status && !error) return null;

  const { tone, text } = error
    ? { tone: "warn" as const, text: `Secret storage key unavailable: ${error}` }
    : describe(status!);
  const Icon = ICONS[tone];

  return (
    <p className={`${styles.status} ${styles[tone]}`} role={tone === "warn" ? "alert" : "status"}>
      <Icon size={13} className={styles.icon} />
      <span>{text}</span>
    </p>
  );
};
