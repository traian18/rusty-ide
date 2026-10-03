import * as providerConnectionProfiles from "./providerConnectionProfiles";

/**
 * Centralized request header construction for catalog and direct execution.
 * Implements deterministic header precedence and redaction for sensitive values.
 */


export interface ProviderHeader {
  name: string;
  value: string;
  secret?: boolean;
}

export interface HeaderConstructionOptions {
  provider: {
    id: string;
    apiKey?: string;
    authType?: string;
    headers?: ProviderHeader[] | Record<string, string>;
  };
  preset?: string;
  model?: {
    headers?: Record<string, string>;
  };
  includeTools?: boolean;
}

/**
 * Get default headers for all requests (JSON API, basic user agent).
 */
function getBaseHeaders(): Record<string, string> {
  return {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };
}

/**
 * Get preset-specific headers (e.g., OpenRouter Referer/X-Title).
 */
function getPresetHeaders(presetId: providerConnectionProfiles.PresetId | undefined): Record<string, string> {
  if (!presetId) return {};

  const preset = providerConnectionProfiles.getPreset(presetId as any);
  if (!preset.preset?.headers) return {};

  return { ...preset.preset.headers };
}

/**
 * Get provider-level extra headers, filtering out reserved names.
 */
function getProviderHeaders(provider: {
  headers?: ProviderHeader[] | Record<string, string>;
}): Record<string, string> {
  if (!provider.headers) {
    return {};
  }

  const result: Record<string, string> = {};
  const reserved = new Set([
    'authorization',
    'x-api-key',
    'anthropic-version',
    'accept',
    'content-type',
  ]);

  // Handle both array format (new ProviderHeader[]) and Record format (legacy)
  if (Array.isArray(provider.headers)) {
    for (const header of provider.headers) {
      if (header && typeof header === 'object' && 'name' in header && 'value' in header) {
        const name = (header as any).name;
        const value = (header as any).value;
        if (typeof name === 'string' && typeof value === 'string' && !reserved.has(name.toLowerCase())) {
          result[name] = value;
        }
      }
    }
  } else if (typeof provider.headers === 'object') {
    // Legacy Record<string, string> format
    for (const [name, value] of Object.entries(provider.headers)) {
      if (typeof value === 'string' && !reserved.has(name.toLowerCase())) {
        result[name] = value;
      }
    }
  }

  return result;
}

/**
 * Get per-model legacy headers (from model definition), filtering reserved.
 */
function getModelHeaders(model: {
  headers?: Record<string, string>;
} | undefined): Record<string, string> {
  if (!model || !model.headers || typeof model.headers !== 'object') {
    return {};
  }

  const result: Record<string, string> = {};
  const reserved = new Set([
    'authorization',
    'x-api-key',
    'anthropic-version',
    'accept',
    'content-type',
  ]);

  for (const [name, value] of Object.entries(model.headers)) {
    if (typeof value === 'string' && !reserved.has(name.toLowerCase())) {
      result[name] = value;
    }
  }

  return result;
}

/**
 * Get protocol-required authentication headers.
 */
function getAuthHeaders(provider: {
  authType?: string;
  apiKey?: string;
}): Record<string, string> {
  const result: Record<string, string> = {};

  const authType = provider.authType || 'none';
  const apiKey = provider.apiKey?.trim();

  if (authType === 'bearer' && apiKey) {
    result['Authorization'] = `Bearer ${apiKey}`;
  } else if (authType === 'anthropic' && apiKey) {
    result['x-api-key'] = apiKey;
    result['anthropic-version'] = '2023-06-01';
  }

  return result;
}

/**
 * Construct headers for a provider request.
 * Precedence: base → preset → provider → model → auth.
 */
export function constructProviderHeaders(options: HeaderConstructionOptions): Record<string, string> {
  const headers: Record<string, string> = {};

  // 1. Base defaults
  Object.assign(headers, getBaseHeaders());

  // 2. Preset headers
  Object.assign(headers, getPresetHeaders(options.preset as providerConnectionProfiles.PresetId | undefined));

  // 3. Provider-level extra headers
  Object.assign(headers, getProviderHeaders(options.provider));

  // 4. Per-model legacy headers
  Object.assign(headers, getModelHeaders(options.model));

  // 5. Protocol-required auth/version headers (last, highest precedence)
  Object.assign(headers, getAuthHeaders(options.provider));

  return headers;
}

/**
 * Get a safely logged version of headers (redacting secrets).
 */
export function getRedactedHeaders(headers: Record<string, string>): Record<string, string> {
  const sensitive = new Set(['authorization', 'x-api-key']);
  const result: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers)) {
    if (sensitive.has(name.toLowerCase())) {
      result[name] = value.substring(0, 2) + '***' + (value.length > 4 ? value.substring(value.length - 2) : '');
    } else {
      result[name] = value;
    }
  }

  return result;
}
