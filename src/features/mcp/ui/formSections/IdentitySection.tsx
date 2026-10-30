import React from "react";
import { useFormContext } from "react-hook-form";
import type { McpFormValues } from "../../model";
import { AlertCircle } from "lucide-react";
import styles from "../McpIntegrationModal.module.css";

/** Props forwarded to IdentitySection for uniqueness validation. */
export interface IdentitySectionProps {
  existingNames?: string[];
  currentName?: string;
}

/**
 * Identity section of the MCP server form.
 *
 * Renders the name, display name, description, and enabled toggle.
 * The name field uses uniqueness validation against existing names.
 */
export function IdentitySection({
  existingNames,
  currentName,
}: IdentitySectionProps): React.ReactElement {
  const {
    register,
    watch,
    setValue,
    formState: { errors },
  } = useFormContext<McpFormValues>();

  const enabled = watch("enabled");

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>Identity</h3>
        <p className={styles.sectionDesc}>
          Unique identifier and human-facing metadata for this server.
        </p>
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label
            className={`${styles.label} ${styles.labelRequired}`}
            htmlFor="mcp-name"
          >
            Name
          </label>
          <input
            id="mcp-name"
            className={`${styles.input} ${errors.name ? styles.inputError : ""}`}
            placeholder="e.g. github-mcp"
            {...register("name", {
              required: "Name is required",
              pattern: {
                value: /^[a-z0-9-_]+$/,
                message: "Lowercase letters, digits, '-' and '_' only",
              },
              validate: (v) => {
                if (v && existingNames?.includes(v) && v !== currentName) {
                  return "A server with this name already exists";
                }
                return true;
              },
            })}
          />
          {errors.name && (
            <span className={styles.error}>
              <AlertCircle size={12} /> {errors.name.message}
            </span>
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="mcp-display">
            Display name (optional)
          </label>
          <input
            id="mcp-display"
            className={styles.input}
            placeholder="GitHub MCP"
            {...register("displayName")}
          />
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="mcp-desc">
          Description (optional)
        </label>
        <textarea
          id="mcp-desc"
          className={styles.textarea}
          rows={2}
          placeholder="What this server exposes..."
          {...register("description")}
        />
      </div>

      <div className={styles.toggleRow}>
        <button
          type="button"
          className={`${styles.toggle} ${enabled ? styles.toggleOn : ""}`}
          onClick={() =>
            setValue("enabled", !enabled, { shouldDirty: true })
          }
          aria-pressed={enabled}
          aria-label="Toggle enabled"
        >
          <span
            className={`${styles.toggleKnob} ${enabled ? styles.toggleKnobOn : ""}`}
          />
        </button>
        <span className={styles.toggleLabel}>
          Enabled {enabled ? "(active)" : "(disabled)"}
        </span>
      </div>
    </section>
  );
}

// ───────────────────── TransportSection ──────────────────
