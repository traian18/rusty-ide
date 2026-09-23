import React, { useEffect, useState } from "react";
import { DownloadCloud } from "lucide-react";
import { Modal } from "./ui/Modal/Modal";
import { Button } from "./ui/Button/Button";
import { Callout } from "./ui/Callout/Callout";
import { useWorkspaceStore } from "../store";
import styles from "./UpdateAvailableModal.module.css";

/**
 * Surfaces the update-available/downloading/error states from
 * createUpdateSlice.ts once the background check (kicked off from
 * AppBootstrapBoundary.tsx, after startup settles) finds a newer release.
 * Rendered unconditionally in App.tsx next to AlertModal/DisclaimerModal --
 * it self-hides via `shouldOffer` rather than a parent gate.
 */
export const UpdateAvailableModal: React.FC = () => {
  const updateState = useWorkspaceStore((state) => state.updateState);
  const installUpdate = useWorkspaceStore((state) => state.installUpdate);
  const skipUpdateVersion = useWorkspaceStore((state) => state.skipUpdateVersion);
  const [dismissed, setDismissed] = useState(false);

  // A later check finding a DIFFERENT newer version should reopen even if
  // the previous one was dismissed ("Remind Me Later") this session.
  useEffect(() => {
    setDismissed(false);
  }, [updateState.latestVersion]);

  const version = updateState.latestVersion;
  const isDownloading = updateState.status === "downloading";
  const shouldOffer =
    !!version &&
    version !== updateState.skippedVersion &&
    !dismissed &&
    (updateState.status === "available" || isDownloading || (updateState.status === "error" && !!updateState.error));

  if (!shouldOffer || !version) return null;

  const progressPercent =
    updateState.contentLength && updateState.contentLength > 0
      ? Math.min(100, Math.round((updateState.downloadedBytes / updateState.contentLength) * 100))
      : null;

  return (
    <Modal
      id="update-available-modal"
      title="Update Available"
      icon={DownloadCloud}
      onClose={() => setDismissed(true)}
      closeOnEscape={!isDownloading}
      closeOnBackdrop={!isDownloading}
      showCloseButton={!isDownloading}
      footer={
        <>
          <Button
            id="update-skip-button"
            type="button"
            variant="secondary"
            disabled={isDownloading}
            onClick={() => skipUpdateVersion(version)}
          >
            Skip This Version
          </Button>
          <Button
            id="update-remind-later-button"
            type="button"
            variant="secondary"
            disabled={isDownloading}
            onClick={() => setDismissed(true)}
          >
            Remind Me Later
          </Button>
          <Button
            id="update-install-button"
            type="button"
            variant="primary"
            loading={isDownloading}
            onClick={() => installUpdate()}
          >
            {updateState.status === "error" ? "Try Again" : "Update Now"}
          </Button>
        </>
      }
    >
      <div className={styles.container}>
        <p className={styles.summary}>
          Rusty IDE {version} is available
          {updateState.currentVersion ? ` — you have ${updateState.currentVersion}.` : "."}
        </p>
        {updateState.releaseNotes && <div className={styles.notes}>{updateState.releaseNotes}</div>}
        {isDownloading && (
          <div className={styles.progress}>
            <div className={styles.progressTrack}>
              <div className={styles.progressFill} style={{ width: `${progressPercent ?? 0}%` }} />
            </div>
            <span className={styles.progressLabel}>
              {progressPercent !== null ? `${progressPercent}%` : "Downloading…"}
            </span>
          </div>
        )}
        {updateState.status === "error" && updateState.error && (
          <Callout variant="danger">{updateState.error}</Callout>
        )}
      </div>
    </Modal>
  );
};
