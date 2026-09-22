import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import styles from "./RuntimeDownloadProgress.module.css";

export interface RuntimeProgress {
  provider: string;
  phase: "downloading" | "installing" | "complete" | "failed" | "cancelled";
  downloaded: number;
  total: number | null;
  message: string | null;
}

const names: Record<string, string> = {
  codex: "Codex",
  "claude-code": "Claude Code",
  "github-copilot": "GitHub Copilot",
};
const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function RuntimeProgressCard({ progress, onDismiss }: {
  progress: RuntimeProgress;
  onDismiss: () => void;
}) {
  const { phase, downloaded, total } = progress;
  const active = phase === "downloading" || phase === "installing";
  const percent = phase === "complete" ? 100
    : phase === "downloading" && total && total > 0
      ? Math.min(100, Math.max(0, Math.floor(downloaded / total * 100)))
      : undefined;
  const label = phase === "downloading" ? "Downloading SDK"
    : phase === "installing" ? "Verifying and installing SDK…"
      : phase === "complete" ? "SDK ready"
        : phase === "cancelled" ? "Download cancelled" : "Download failed";

  return (
    <section className={styles.card} aria-label={`${names[progress.provider] ?? progress.provider} SDK download`}>
      <div className={styles.heading}>
        <strong>{names[progress.provider] ?? progress.provider}</strong>
        {!active && <button type="button" onClick={onDismiss} aria-label="Dismiss download status">×</button>}
      </div>
      <div className={styles.status} role="status">
        <span>{label}</span>
        {phase === "downloading" && percent !== undefined && <span>{percent}%</span>}
      </div>
      {(active || phase === "complete") && (
        <div className={styles.track} role="progressbar" aria-label={label}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
          aria-valuetext={phase === "installing" ? label : undefined}>
          <span className={percent === undefined ? styles.indeterminate : styles.fill}
            style={percent === undefined ? undefined : { width: `${percent}%` }} />
        </div>
      )}
      {phase === "downloading" && <small>{megabytes(downloaded)}{total ? ` of ${megabytes(total)}` : " downloaded"}</small>}
      {phase === "failed" && <p role="alert">{progress.message || "Please try again."}</p>}
    </section>
  );
}

/** Shell-level indicator stays visible if a download starts from a session
 * or the user leaves integration settings while installation is running. */
export function RuntimeDownloadProgress() {
  const [downloads, setDownloads] = useState<Record<string, RuntimeProgress>>({});
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const unlisten = listen<RuntimeProgress>("managed-runtime-progress", ({ payload }) => {
      if (!disposed) setDownloads((current) => ({ ...current, [payload.provider]: payload }));
    });
    return () => {
      disposed = true;
      void unlisten.then((stop) => stop());
    };
  }, []);

  return <aside className={styles.container} aria-label="SDK downloads">
    {Object.values(downloads).map((progress) => (
      <RuntimeProgressCard key={progress.provider} progress={progress} onDismiss={() => {
        setDownloads((current) => {
          const next = { ...current };
          delete next[progress.provider];
          return next;
        });
      }} />
    ))}
  </aside>;
}
