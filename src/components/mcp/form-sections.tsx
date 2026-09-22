// ============================================================
// form-sections.tsx — Form section sub-components extracted
// from McpIntegrationModal.
//
// Each section uses `useFormContext` to access the shared form
// state provided by the parent via <FormProvider>.
// ============================================================

import React from "react";
import {
  useFormContext,
  useFieldArray,
} from "react-hook-form";
import type { McpFormValues } from "./types";
import {
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Info,
} from "lucide-react";
import {
  TRANSPORT_OPTIONS,
  AUTH_OPTIONS,
  GRANT_OPTIONS,
} from "./constants";
import { isValidUrl } from "./form-utils";
import type { TestState } from "./connection-test";
import styles from "./McpIntegrationModal.module.css";

// ───────────────────── IdentitySection ───────────────────

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

/**
 * Authentication section of the MCP server form.
 *
 * Renders the auth type selector and the corresponding credential fields
 * for apiKey (header + value), bearer (token), or oauth2 (clientId,
 * clientSecret, tokenUrl, grantType, scopes).
 */
export function AuthSection(): React.ReactElement {
  const {
    register,
    watch,
    formState: { errors },
  } = useFormContext<McpFormValues>();

  const authType = watch("authType");

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>Authentication</h3>
        <p className={styles.sectionDesc}>
          Credentials applied to every request. Secrets support{" "}
          <span className={styles.code}>${"{ENV_VAR}"}</span> interpolation.
        </p>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="mcp-auth">
          Auth type
        </label>
        <select
          id="mcp-auth"
          className={styles.select}
          {...register("authType")}
        >
          {AUTH_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {authType === "apiKey" && (
        <div className={styles.row}>
          <div className={styles.field}>
            <label
              className={`${styles.label} ${styles.labelRequired}`}
              htmlFor="mcp-header"
            >
              Header name
            </label>
            <input
              id="mcp-header"
              className={`${styles.input} ${errors.header ? styles.inputError : ""}`}
              placeholder="X-API-Key"
              {...register("header", {
                validate: (v, fv) =>
                  fv.authType === "apiKey"
                    ? v
                      ? true
                      : "Header name is required"
                    : true,
              })}
            />
            {errors.header && (
              <span className={styles.error}>
                <AlertCircle size={12} /> {errors.header.message}
              </span>
            )}
          </div>
          <div className={styles.field}>
            <label
              className={`${styles.label} ${styles.labelRequired}`}
              htmlFor="mcp-value"
            >
              Value
            </label>
            <input
              id="mcp-value"
              type="password"
              className={`${styles.input} ${errors.value ? styles.inputError : ""}`}
              placeholder="${API_KEY}"
              autoComplete="off"
              {...register("value", {
                validate: (v, fv) =>
                  fv.authType === "apiKey"
                    ? v
                      ? true
                      : "API key value is required"
                    : true,
              })}
            />
            {errors.value && (
              <span className={styles.error}>
                <AlertCircle size={12} /> {errors.value.message}
              </span>
            )}
          </div>
        </div>
      )}

      {authType === "bearer" && (
        <div className={styles.field}>
          <label
            className={`${styles.label} ${styles.labelRequired}`}
            htmlFor="mcp-token"
          >
            Token
          </label>
          <input
            id="mcp-token"
            type="password"
            className={`${styles.input} ${errors.token ? styles.inputError : ""}`}
            placeholder="${BEARER_TOKEN}"
            autoComplete="off"
            {...register("token", {
              validate: (v, fv) =>
                fv.authType === "bearer"
                  ? v
                    ? true
                    : "Bearer token is required"
                  : true,
            })}
          />
          {errors.token && (
            <span className={styles.error}>
              <AlertCircle size={12} /> {errors.token.message}
            </span>
          )}
        </div>
      )}

      {authType === "oauth2" && (
        <>
          <div className={styles.row}>
            <div className={styles.field}>
              <label
                className={`${styles.label} ${styles.labelRequired}`}
                htmlFor="mcp-client-id"
              >
                Client ID
              </label>
              <input
                id="mcp-client-id"
                className={`${styles.input} ${errors.clientId ? styles.inputError : ""}`}
                placeholder="client-id"
                {...register("clientId", {
                  validate: (v, fv) =>
                    fv.authType === "oauth2"
                      ? v
                        ? true
                        : "Client ID is required"
                      : true,
                })}
              />
              {errors.clientId && (
                <span className={styles.error}>
                  <AlertCircle size={12} /> {errors.clientId.message}
                </span>
              )}
            </div>
            <div className={styles.field}>
              <label
                className={`${styles.label} ${styles.labelRequired}`}
                htmlFor="mcp-client-secret"
              >
                Client secret
              </label>
              <input
                id="mcp-client-secret"
                type="password"
                className={`${styles.input} ${errors.clientSecret ? styles.inputError : ""}`}
                placeholder="${CLIENT_SECRET}"
                autoComplete="off"
                {...register("clientSecret", {
                  validate: (v, fv) =>
                    fv.authType === "oauth2"
                      ? v
                        ? true
                        : "Client secret is required"
                      : true,
                })}
              />
              {errors.clientSecret && (
                <span className={styles.error}>
                  <AlertCircle size={12} /> {errors.clientSecret.message}
                </span>
              )}
            </div>
          </div>

          <div className={styles.row}>
            <div className={styles.field}>
              <label
                className={`${styles.label} ${styles.labelRequired}`}
                htmlFor="mcp-token-url"
              >
                Token URL
              </label>
              <input
                id="mcp-token-url"
                className={`${styles.input} ${errors.tokenUrl ? styles.inputError : ""}`}
                placeholder="https://auth.example.com/oauth/token"
                {...register("tokenUrl", {
                  validate: (v, fv) =>
                    fv.authType === "oauth2"
                      ? v
                        ? true
                        : "Token URL is required"
                      : true,
                })}
              />
              {errors.tokenUrl && (
                <span className={styles.error}>
                  <AlertCircle size={12} /> {errors.tokenUrl.message}
                </span>
              )}
            </div>
            <div className={styles.field}>
              <label
                className={`${styles.label} ${styles.labelRequired}`}
                htmlFor="mcp-grant"
              >
                Grant type
              </label>
              <select
                id="mcp-grant"
                className={styles.select}
                {...register("grantType", {
                  validate: (v, fv) =>
                    fv.authType === "oauth2"
                      ? v
                        ? true
                        : "Grant type is required"
                      : true,
                })}
              >
                {GRANT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="mcp-scopes">
              Scopes (comma-separated)
            </label>
            <input
              id="mcp-scopes"
              className={styles.input}
              placeholder="read:repo, write:repo"
              {...register("scopesText")}
            />
          </div>
        </>
      )}

      {authType !== "none" && (
        <p className={styles.hint}>
          <Info size={13} className={styles.hintIcon} />
          <span>
            Use <span className={styles.code}>${"{ENV_VAR}"}</span> to reference
            environment variables — resolved at runtime, never stored or logged
            in plaintext.
          </span>
        </p>
      )}
    </section>
  );
}

// ───────────────────── EnvironmentSection ────────────────

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
