import React, { useEffect, useState, useCallback } from "react";
import { Trash2, RotateCcw, Database } from "lucide-react";
import { Button } from "../ui";
import {
  clearStorageCache,
  getStorageCacheBreakdown,
  type StorageCacheBreakdown,
} from "../../services/storageCacheService";
import { notify } from "../../notificationStore";
import styles from "./StorageSettings.module.css";

export const StorageSettings: React.FC = () => {
  const [breakdown, setBreakdown] = useState<StorageCacheBreakdown | null>(null);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);

  const fetchSize = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getStorageCacheBreakdown();
      setBreakdown(data);
    } catch {
      // Best effort fallback
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSize();
  }, [fetchSize]);

  const handleDeleteCache = async () => {
    setClearing(true);
    try {
      const updated = await clearStorageCache();
      setBreakdown(updated);
      notify("Cache Cleared", "Temporary cache, logs, and diagnostic data have been cleared.", "success");
    } catch (e) {
      notify("Failed to Clear Cache", String(e), "danger");
    } finally {
      setClearing(false);
    }
  };

  const formattedSize = breakdown?.formatted ?? (loading ? "Calculating…" : "0 KB");
  const isClearDisabled = clearing || loading || (breakdown !== null && breakdown.totalBytes === 0);

  return (
    <section className={styles.section} aria-labelledby="storage-settings-title">
      <div className={styles.heading}>
        <div>
          <h3 className={styles.title} id="storage-settings-title">Storage & Cache</h3>
          <p className={styles.description}>
            Manage application cache, log files, and temporary diagnostic history stored on your machine.
          </p>
        </div>
        <Button
          id="storage-cache-refresh"
          variant="ghost"
          icon={<RotateCcw size={13} className={loading ? "animate-spin" : undefined} />}
          onClick={fetchSize}
          disabled={loading || clearing}
          title="Refresh cache size"
        >
          Refresh
        </Button>
      </div>

      <div className={styles.card}>
        <div className={styles.info}>
          <div className={styles.labelRow}>
            <Database size={15} className="text-[var(--color-fg-muted)]" />
            <span className={styles.label}>Application Cache & Logs</span>
            <span id="storage-cache-size" className={styles.sizeBadge}>
              {formattedSize}
            </span>
          </div>
          <p className={styles.hint}>
            Includes WebView cache, sidecar process logs, and local execution telemetry. Clearing cache will not affect your workspaces, project files, or settings.
          </p>
        </div>

        <div className={styles.actions}>
          <Button
            id="storage-cache-delete"
            variant="danger"
            icon={<Trash2 size={13} />}
            onClick={handleDeleteCache}
            loading={clearing}
            disabled={isClearDisabled}
          >
            Delete Cache
          </Button>
        </div>
      </div>
    </section>
  );
};
