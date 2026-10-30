import React from "react";
import { useFormContext } from "react-hook-form";
import type { McpFormValues } from "../../model";
import { AlertCircle, Info } from "lucide-react";
import { AUTH_OPTIONS, GRANT_OPTIONS } from "../../service/constants";
import styles from "../McpIntegrationModal.module.css";

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
