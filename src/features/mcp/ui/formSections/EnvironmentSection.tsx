import React from "react";
import { useFormContext, useFieldArray } from "react-hook-form";
import type { McpFormValues } from "../../model";
import { Plus, Trash2 } from "lucide-react";
import styles from "../McpIntegrationModal.module.css";

/**
 * Environment variables section of the MCP server form.
 *
 * Renders key-value pair inputs for stdio transport environment
 * variables. Only visible when the transport type is stdio.
 */
export function EnvironmentSection(): React.ReactElement {
  const { register, watch, control } = useFormContext<McpFormValues>();

  const transportType = watch("transportType");
  const isStdio = transportType === "stdio";

  const { fields, append, remove } = useFieldArray({ control, name: "env" });

  if (!isStdio) return <></>;

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>Environment variables</h3>
        <p className={styles.sectionDesc}>
          Passed to the spawned stdio process.
        </p>
      </div>

      <div className={styles.kvList}>
        {fields.length === 0 && (
          <p className={styles.emptyNote}>No environment variables set.</p>
        )}
        {fields.map((field, index) => (
          <div key={field.id} className={styles.kvRow}>
            <input
              className={styles.input}
              placeholder="KEY"
              defaultValue={field.key}
              {...register(`env.${index}.key`)}
            />
            <input
              className={styles.input}
              placeholder="value or ${ENV_VAR}"
              defaultValue={field.value}
              {...register(`env.${index}.value`)}
            />
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => remove(index)}
              aria-label="Remove variable"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className={styles.addBtn}
        onClick={() => append({ key: "", value: "" })}
      >
        <Plus size={12} /> Add variable
      </button>
    </section>
  );
}

// ───────────────────── AdvancedSection ───────────────────
