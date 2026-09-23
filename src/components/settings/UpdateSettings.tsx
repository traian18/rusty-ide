import React, { useEffect } from "react";
import { CheckCircle2, Download, RefreshCw } from "lucide-react";
import { Button } from "../ui";
import { useWorkspaceStore } from "../../store";
import styles from "./UpdateSettings.module.css";

/**
 * Mirrors StorageSettings.tsx's card layout: a refreshable status line plus
 * an action button, backed by createUpdateSlice.ts (the same slice the
 * startup-triggered UpdateAvailableModal reads). Triggers its own check on
 * first mount only when nothing has run yet -- normally the background
 * startup check (AppBootstrapBoundary.tsx) already beat it there, so this
 * just covers "Settings opened before that finished" and "app has been
 * running a while, user wants a fresh check" via the button.
 */
export const UpdateSettings: React.FC = () => {
  const updateState = useWorkspaceStore((state) => state.updateState);
  const checkForUpdates = useWorkspaceStore((state) => state.checkForUpdates);
  const installUpdate = useWorkspaceStore((state) => state.installUpdate);

  useEffect(() => {
    if (updateState.status === "idle") {
      void checkForUpdates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isChecking = updateState.status === "checking" || updateState.status === "idle";
  const isDownloading = updateState.status === "downloading";
  const isAvailable = updateState.status === "available" || isDownloading || (updateState.status === "error" && !!updateState.latestVersion);

  const statusLine = (() => {
    switch (updateState.status) {
      case "idle":
      case "checking":
        return "Checking for updates…";
      case "up-to-date":
        return "You're up to date.";
      case "available":
        return `Version ${updateState.latestVersion} is available.`;
      case "downloading":
        return `Downloading version ${updateState.latestVersion}…`;
      case "error":
        return updateState.latestVersion
          ? `Couldn't install version ${updateState.latestVersion}: ${updateState.error}`
          : `Couldn't check for updates: ${updateState.error}`;
      default:
        return "";
    }
  })();

  return (
    <section className={styles.section} aria-labelledby="update-settings-title">
      <div className={styles.heading}>
        <div>
          <h3 className={styles.title} id="update-settings-title">Software Update</h3>
          <p className={styles.description}>Check for and install the latest version of Rusty IDE.</p>
        </div>
        <Button
          id="update-check-button"
          variant="ghost"
          icon={<RefreshCw size={13} className={isChecking ? "animate-spin" : undefined} />}
          onClick={() => checkForUpdates()}
          disabled={isChecking || isDownloading}
        >
          Check for Updates
        </Button>
      </div>

      <div className={styles.card}>
        <div className={styles.info}>
          <div className={styles.labelRow}>
            {updateState.status === "up-to-date" ? (
              <CheckCircle2 size={15} className="text-[var(--color-status-success)]" />
            ) : (
              <Download size={15} className="text-[var(--color-fg-muted)]" />
            )}
            <span className={styles.label}>
              Current version{updateState.currentVersion ? ` ${updateState.currentVersion}` : ""}
            </span>
          </div>
          <p className={styles.hint}>{statusLine}</p>
        </div>

        {isAvailable && (
          <div className={styles.actions}>
            <Button
              id="update-settings-install-button"
              variant="primary"
              icon={<Download size={13} />}
              loading={isDownloading}
              onClick={() => installUpdate()}
            >
              {updateState.status === "error" ? "Try Again" : "Update Now"}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
};
