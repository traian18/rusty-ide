import React from "react";
import { Power, Trash2 } from "lucide-react";
import { GitHubIcon } from "./icons";
import styles from "./SpecializedMcp.module.css";
import type { GitHubMcpModel } from "./useGitHubMcp";

export function GitHubMcpHeaderCard({ model }: { model: GitHubMcpModel }): React.ReactElement {
  const { handleToggleEnabled, handleDisconnect, isConfigured, isEnabled } = model;

  return (
    <>
      {/* Header Card */}
      <div className={styles.headerCard}>
        <div className={styles.headerLeft}>
          <div className={styles.brandIconWrapper}>
            <GitHubIcon size={28} />
          </div>
          <div className={styles.headerText}>
            <div className="flex items-center gap-2">
              <h3 className={styles.title}>GitHub MCP Integration</h3>
              {isConfigured ? (
                <span
                  className={`${styles.statusPill} ${
                    isEnabled ? styles.statusPillActive : styles.statusPillDisabled
                  }`}
                >
                  <span className={styles.statusDot} />
                  {isEnabled ? "Connected & Active" : "Configured (Disabled)"}
                </span>
              ) : (
                <span className={styles.statusPill}>
                  <span className={styles.statusDot} />
                  Not Configured
                </span>
              )}
            </div>
            <p className={styles.description}>
              Allows your AI agents to explore GitHub repositories, search code, read & write issues,
              and manage pull requests directly within Rusty.
            </p>
          </div>
        </div>

        {isConfigured && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleToggleEnabled}
              className={`${styles.buttonSecondary} ${
                isEnabled ? "text-[var(--color-status-success)]" : "text-[var(--color-fg-muted)]"
              }`}
              title={isEnabled ? "Disable server" : "Enable server"}
            >
              <Power size={14} />
              <span>{isEnabled ? "Enabled" : "Disabled"}</span>
            </button>
            <button
              onClick={handleDisconnect}
              className={styles.buttonDanger}
              title="Remove GitHub integration"
            >
              <Trash2 size={14} />
              <span>Disconnect</span>
            </button>
          </div>
        )}
      </div>
    </>
  );
}
