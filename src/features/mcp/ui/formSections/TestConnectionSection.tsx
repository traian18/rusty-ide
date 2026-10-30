import React from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import type { TestState } from "../connection-test";
import styles from "../McpIntegrationModal.module.css";

/** Props forwarded to TestConnectionSection. */
export interface TestConnectionSectionProps {
  test: TestState;
  onTest: () => Promise<void>;
}

/**
 * Test connection section of the MCP server form.
 *
 * Renders the "Test connection" button and shows the probe result
 * (success, error, or testing spinner).
 */
export function TestConnectionSection({
  test,
  onTest,
}: TestConnectionSectionProps): React.ReactElement {
  return (
    <div className={styles.testRow}>
      <button
        type="button"
        className={`${styles.btn} ${styles.btnTest}`}
        onClick={onTest}
        disabled={test.status === "testing"}
      >
        {test.status === "testing" ? (
          <Loader2 size={14} className={styles.spin} />
        ) : (
          "Test connection"
        )}
      </button>
      {test.status !== "idle" && (
        <div
          className={`${styles.testResult} ${
            test.status === "success"
              ? styles.testSuccess
              : test.status === "error"
                ? styles.testError
                : styles.testPending
          }`}
        >
          {test.status === "success" && <CheckCircle2 size={15} />}
          {test.status === "error" && <AlertCircle size={15} />}
          {test.status === "testing" && (
            <Loader2 size={15} className={styles.spin} />
          )}
          <span>{test.message}</span>
        </div>
      )}
    </div>
  );
}
