import React from "react";
import { useFormContext } from "react-hook-form";
import type { McpFormValues } from "../../model";
import { AlertCircle } from "lucide-react";
import styles from "../McpIntegrationModal.module.css";

/**
 * Advanced section of the MCP server form.
 *
 * Renders timeout, max retries, and retry delay numeric inputs.
 */
export function AdvancedSection(): React.ReactElement {
  const {
    register,
    formState: { errors },
  } = useFormContext<McpFormValues>();

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>Advanced</h3>
        <p className={styles.sectionDesc}>
          Timeouts and retry behavior for the client connection.
        </p>
      </div>

      <div className={styles.rowThree}>
        <div className={styles.field}>
          <label
            className={`${styles.label} ${styles.labelRequired}`}
            htmlFor="mcp-timeout"
          >
            Timeout (ms)
          </label>
          <input
            id="mcp-timeout"
            type="number"
            className={`${styles.input} ${errors.timeout ? styles.inputError : ""}`}
            {...register("timeout", {
              valueAsNumber: true,
              validate: (v) =>
                (Number.isFinite(v) && v >= 0) || "Enter a positive number",
            })}
          />
          {errors.timeout && (
            <span className={styles.error}>
              <AlertCircle size={12} /> {errors.timeout.message}
            </span>
          )}
        </div>

        <div className={styles.field}>
          <label
            className={`${styles.label} ${styles.labelRequired}`}
            htmlFor="mcp-retries"
          >
            Max retries (0–10)
          </label>
          <input
            id="mcp-retries"
            type="number"
            min={0}
            max={10}
            className={`${styles.input} ${errors.maxRetries ? styles.inputError : ""}`}
            {...register("maxRetries", {
              valueAsNumber: true,
              validate: (v) =>
                (Number.isFinite(v) && v >= 0 && v <= 10) ||
                "Enter a number 0–10",
            })}
          />
          {errors.maxRetries && (
            <span className={styles.error}>
              <AlertCircle size={12} /> {errors.maxRetries.message}
            </span>
          )}
        </div>

        <div className={styles.field}>
          <label
            className={`${styles.label} ${styles.labelRequired}`}
            htmlFor="mcp-retry-delay"
          >
            Retry delay (ms)
          </label>
          <input
            id="mcp-retry-delay"
            type="number"
            className={`${styles.input} ${errors.retryDelay ? styles.inputError : ""}`}
            {...register("retryDelay", {
              valueAsNumber: true,
              validate: (v) =>
                (Number.isFinite(v) && v >= 0) || "Enter a positive number",
            })}
          />
          {errors.retryDelay && (
            <span className={styles.error}>
              <AlertCircle size={12} /> {errors.retryDelay.message}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

// ───────────────────── TestConnectionSection ─────────────
