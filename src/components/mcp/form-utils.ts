// ============================================================
// form-utils.ts — Data transformation utilities for the
// MCP integration form (McpFormValues ↔ McpServerConfig)
// ============================================================

import type { McpServerConfig, McpFormValues, TransportType } from "./types";
import { EMPTY_FORM_VALUES } from "./constants";

/**
 * Checks whether a URL uses an accepted protocol (http, https, ws, wss).
 * Returns false for unparseable strings or unsupported protocols.
 */
export function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return ["http:", "https:", "ws:", "wss:"].includes(u.protocol);
  } catch {
    return false;
  }
}

/**
 * Converts an optional persistent server config into form default values.
 * When no config is provided, returns a copy of `EMPTY_FORM_VALUES`.
 *
 * The inverse operation is `toServerConfig`.
 */
export function toFormValues(cfg?: McpServerConfig): McpFormValues {
  if (!cfg) return { ...EMPTY_FORM_VALUES };

  return {
    name: cfg.name,
    displayName: cfg.displayName ?? "",
    description: cfg.description ?? "",
    enabled: cfg.enabled,
    transportType: cfg.transport.type,
    url: cfg.transport.url ?? "",
    command: cfg.transport.command ?? "",
    args: (cfg.transport.args ?? []).map((a) => ({ value: a })),
    env: Object.entries(cfg.transport.env ?? {}).map(([key, value]) => ({
      key,
      value,
    })),
    authType: cfg.auth.type,
    header: cfg.auth.header ?? "",
    value: cfg.auth.value ?? "",
    token: cfg.auth.token ?? "",
    clientId: cfg.auth.clientId ?? "",
    clientSecret: cfg.auth.clientSecret ?? "",
    tokenUrl: cfg.auth.tokenUrl ?? "",
    scopesText: (cfg.auth.scopes ?? []).join(", "),
    grantType: cfg.auth.grantType ?? "client_credentials",
    timeout: cfg.timeout,
    maxRetries: cfg.maxRetries,
    retryDelay: cfg.retryDelay,
  };
}

/**
 * Converts validated form values into a `McpServerConfig` for persistence.
 *
 * The inverse operation is `toFormValues`. Call this before passing data
 * to the `onSave` callback.
 */
export function toServerConfig(values: McpFormValues): McpServerConfig {
  const isStdio = values.transportType === "stdio";

  const transport = isStdio
    ? {
        type: values.transportType as TransportType,
        command: values.command,
        args: values.args.map((a) => a.value).filter((a) => a.length > 0),
        env: values.env.reduce<Record<string, string>>((acc, row) => {
          const key = row.key.trim();
          if (key) acc[key] = row.value;
          return acc;
        }, {}),
      }
    : {
        type: values.transportType as TransportType,
        url: values.url,
      };

  const auth: McpServerConfig["auth"] = { type: values.authType };

  if (values.authType === "apiKey") {
    auth.header = values.header;
    auth.value = values.value;
  } else if (values.authType === "bearer") {
    auth.token = values.token;
  } else if (values.authType === "oauth2") {
    auth.clientId = values.clientId;
    auth.clientSecret = values.clientSecret;
    auth.tokenUrl = values.tokenUrl;
    auth.scopes = values.scopesText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    auth.grantType = values.grantType;
  }

  return {
    name: values.name,
    displayName: values.displayName || undefined,
    description: values.description || undefined,
    enabled: values.enabled,
    transport,
    auth,
    timeout: values.timeout,
    maxRetries: values.maxRetries,
    retryDelay: values.retryDelay,
  };
}

/**
 * Transforms form values into a server config and invokes the save callback.
 * Designed to be passed directly to react-hook-form's `handleSubmit`.
 */
export function handleFormSubmit(
  values: McpFormValues,
  onSave: (config: McpServerConfig) => void,
): void {
  onSave(toServerConfig(values));
}
