// MCP (Model Context Protocol) server configuration types.
//
// The persisted file shape is `McpConfigFile` — a map of server entries keyed
// by name. `McpServerConfig` describes a single server entry, which is what
// `McpIntegrationModal` produces via `onSave`.

export type TransportType = "sse" | "http" | "stdio" | "websocket";
export type AuthType = "none" | "apiKey" | "bearer" | "oauth2";
export type OAuthGrantType = "client_credentials" | "authorization_code";

export interface TransportConfig {
  type: TransportType;
  /** Required for sse / http / websocket. */
  url?: string;
  /** Required for stdio. */
  command?: string;
  /** Optional, stdio only. */
  args?: string[];
  /** Optional, stdio only. */
  env?: Record<string, string>;
}

export interface AuthConfig {
  type: AuthType;
  /** apiKey only. */
  header?: string;
  /** apiKey only. Supports ${ENV_VAR} interpolation. */
  value?: string;
  /** bearer only. Supports ${ENV_VAR} interpolation. */
  token?: string;
  /** oauth2 only. */
  clientId?: string;
  /** oauth2 only. Supports ${ENV_VAR} interpolation. */
  clientSecret?: string;
  /** oauth2 only. */
  tokenUrl?: string;
  /** oauth2 only. */
  scopes?: string[];
  /** oauth2 only. */
  grantType?: OAuthGrantType;
}

export interface McpServerConfig {
  /** Required, unique, lowercase, no spaces. */
  name: string;
  displayName?: string;
  description?: string;
  enabled: boolean;
  transport: TransportConfig;
  auth: AuthConfig;
  /** ms, default 30000. */
  timeout: number;
  /** 0–10, default 3. */
  maxRetries: number;
  /** ms, default 1000. */
  retryDelay: number;
}

/** Top-level persisted config object matching the MCP config schema. */
export interface McpConfigFile {
  mcpServers: Record<string, McpServerConfig>;
}

export interface McpIntegrationModalProps {
  /** Populated when editing an existing server. */
  initialConfig?: McpServerConfig;
  /** Names already in use, for uniqueness validation. */
  existingNames?: string[];
  onSave: (config: McpServerConfig) => void;
  onCancel: () => void;
}

// ---- Internal form-only types ----

export interface EnvRow {
  key: string;
  value: string;
}

export interface ArgRow {
  value: string;
}

export interface McpFormValues {
  name: string;
  displayName: string;
  description: string;
  enabled: boolean;
  transportType: TransportType;
  url: string;
  command: string;
  args: ArgRow[];
  env: EnvRow[];
  authType: AuthType;
  header: string;
  value: string;
  token: string;
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  scopesText: string;
  grantType: OAuthGrantType;
  timeout: number;
  maxRetries: number;
  retryDelay: number;
}

export const DEFAULT_SERVER_CONFIG: McpServerConfig = {
  name: "",
  enabled: true,
  transport: { type: "http" },
  auth: { type: "none" },
  timeout: 30000,
  maxRetries: 3,
  retryDelay: 1000,
};
