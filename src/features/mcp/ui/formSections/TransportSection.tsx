import React from "react";
import { useFormContext, useFieldArray } from "react-hook-form";
import type { McpFormValues } from "../../model";
import { Plus, Trash2, AlertCircle } from "lucide-react";
import { TRANSPORT_OPTIONS } from "../../service/constants";
import { isValidUrl } from "../../service/form-utils";
import styles from "../McpIntegrationModal.module.css";

/**
 * Transport section of the MCP server form.
 *
 * Renders the transport type selector, URL input (for network transports),
 * and command + arguments inputs (for stdio transport).
 */
export function TransportSection(): React.ReactElement {
  const {
    register,
    watch,
    control,
    formState: { errors },
  } = useFormContext<McpFormValues>();

  const transportType = watch("transportType");
  const isStdio = transportType === "stdio";

  const { fields, append, remove } = useFieldArray({ control, name: "args" });

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>Transport</h3>
        <p className={styles.sectionDesc}>
          How the client connects to this server.
        </p>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="mcp-transport">
          Transport type
        </label>
        <select
          id="mcp-transport"
          className={styles.select}
          {...register("transportType")}
        >
          {TRANSPORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {!isStdio && (
        <div className={styles.field}>
          <label
            className={`${styles.label} ${styles.labelRequired}`}
            htmlFor="mcp-url"
          >
            URL
          </label>
          <input
            id="mcp-url"
            className={`${styles.input} ${errors.url ? styles.inputError : ""}`}
            placeholder={
              transportType === "websocket"
                ? "wss://server.example.com/mcp"
                : "https://server.example.com/mcp"
            }
            {...register("url", {
              validate: (v, fv) => {
                if (fv.transportType === "stdio") return true;
                if (!v) return "URL is required";
                if (!isValidUrl(v)) return "Enter a valid http(s) or ws(s) URL";
                return true;
              },
            })}
          />
          {errors.url && (
            <span className={styles.error}>
              <AlertCircle size={12} /> {errors.url.message}
            </span>
          )}
        </div>
      )}

      {isStdio && (
        <>
          <div className={styles.field}>
            <label
              className={`${styles.label} ${styles.labelRequired}`}
              htmlFor="mcp-command"
            >
              Command
            </label>
            <input
              id="mcp-command"
              className={`${styles.input} ${errors.command ? styles.inputError : ""}`}
              placeholder="e.g. npx"
              {...register("command", {
                validate: (v, fv) =>
                  fv.transportType === "stdio"
                    ? v
                      ? true
                      : "Command is required"
                    : true,
              })}
            />
            {errors.command && (
              <span className={styles.error}>
                <AlertCircle size={12} /> {errors.command.message}
              </span>
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Arguments</label>
            <div className={styles.kvList}>
              {fields.length === 0 && (
                <p className={styles.emptyNote}>No arguments.</p>
              )}
              {fields.map((field, index) => (
                <div key={field.id} className={styles.kvRow}>
                  <input
                    className={styles.input}
                    placeholder={`arg ${index + 1}`}
                    defaultValue={field.value}
                    {...register(`args.${index}.value`)}
                  />
                  <span />
                  <button
                    type="button"
                    className={styles.iconBtn}
                    onClick={() => remove(index)}
                    aria-label="Remove argument"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className={styles.addBtn}
              onClick={() => append({ value: "" })}
            >
              <Plus size={12} /> Add argument
            </button>
          </div>
        </>
      )}
    </section>
  );
}

// ───────────────────── AuthSection ───────────────────────
