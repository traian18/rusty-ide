/**
 * Shared provider connection validation and URL policy.
 * Centralizes draft validation for save, catalog discovery, and inference testing.
 */

/**
 * Validation result for provider configuration.
 */
export interface ProviderConfigValidationResult {
  valid: boolean;
  baseUrlError?: string;
  catalogUrlError?: string;
  authenticationError?: string;
  headersError?: string;
  warnings: string[];
}

/**
 * Check if a URL is a valid HTTP(S) URL.
 */
function isValidHttpUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Check if a hostname is a loopback address (127.0.0.1, localhost, ::1, etc.).
 */
function isLoopbackHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '::1' ||
    lower === '[::1]'
  );
}

/**
 * Check if a hostname is in a private RFC1918 network.
 * Covers 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16.
 */
function isPrivateNetworkHost(hostname: string): boolean {
  // Remove IPv6 brackets if present
  const clean = hostname.replace(/^\[|\]$/g, '');

  // IPv6 loopback
  if (clean === '::1') return true;

  // IPv6 link-local and private (fc00::/7)
  if (clean.startsWith('fe80:') || clean.startsWith('fc') || clean.startsWith('fd')) {
    return true;
  }

  // IPv4 parsing
  const octets = clean.split('.');
  if (octets.length !== 4) return false;

  const nums = octets.map(o => {
    const n = parseInt(o, 10);
    return isNaN(n) ? -1 : n;
  });

  if (nums.some(n => n < 0 || n > 255)) return false;

  // 10.0.0.0/8
  if (nums[0] === 10) return true;

  // 172.16.0.0/12
  if (nums[0] === 172 && nums[1] >= 16 && nums[1] <= 31) return true;

  // 192.168.0.0/16
  if (nums[0] === 192 && nums[1] === 168) return true;

  return false;
}

/**
 * Validate a base or catalog URL according to HTTP safety policy.
 * Returns error message if invalid, warning message if allowed with caution, or undefined if valid.
 */
export function validateProviderUrl(
  urlString: string,
  kind: 'base' | 'catalog' = 'base'
): { error?: string; warning?: string } {
  if (!urlString.trim()) {
    return { error: `${kind} URL is required` };
  }

  if (!isValidHttpUrl(urlString)) {
    return { error: `${kind} URL must be a valid HTTP(S) URL (e.g., http://localhost:8000/v1)` };
  }

  try {
    const url = new URL(urlString);

    // HTTPS is always allowed
    if (url.protocol === 'https:') {
      return {};
    }

    // HTTP: check if target is loopback or private
    if (url.protocol === 'http:') {
      const hostname = url.hostname;

      if (isLoopbackHost(hostname)) {
        return {};
      }

      if (isPrivateNetworkHost(hostname)) {
        return {
          warning: `${kind} uses unencrypted HTTP on a private network. Consider using HTTPS if available.`,
        };
      }

      // Public HTTP is not allowed
      return {
        error: `${kind} cannot use unencrypted HTTP for public endpoints. Use HTTPS or configure a local/private endpoint.`,
      };
    }
  } catch {
    return { error: `${kind} URL is invalid` };
  }

  return {};
}

/**
 * Validate header name as RFC 7230 token.
 * Header field names are tokens (must not contain separators or control characters).
 */
function isValidHeaderName(name: string): boolean {
  // RFC 7230: token = 1*tchar
  // tchar = "!" / "#" / "$" / "%" / "&" / "'" / "*" / "+" / "-" / "." /
  //         "0-9" / "A-Z" / "^-z" / "|" / "~"
  // Simplification: allow alphanumeric, hyphen, underscore; disallow spaces, colons, slashes
  if (!name || name.length === 0) return false;
  return /^[a-zA-Z0-9\-_]+$/.test(name);
}

/**
 * Check if a header value contains CR/LF injection attempt.
 */
function hasHeaderInjection(value: string): boolean {
  return /[\r\n]/.test(value);
}

/**
 * Set of reserved headers that cannot be supplied as generic provider headers.
 */
const RESERVED_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'anthropic-version',
  'accept',
  'content-type',
  'content-length',
  'transfer-encoding',
  'host',
  'connection',
  'upgrade',
  'te',
  'trailer',
]);

/**
 * Check if a header name is reserved and cannot be supplied by the user.
 */
export function isReservedHeader(name: string): boolean {
  return RESERVED_HEADERS.has(name.toLowerCase());
}

/**
 * Validate a set of provider headers.
 */
export function validateProviderHeaders(
  headers?: Array<{ name: string; value: string; secret?: boolean }>
): { error?: string } {
  if (!headers || headers.length === 0) return {};

  for (const header of headers) {
    if (!isValidHeaderName(header.name)) {
      return { error: `Header name "${header.name}" contains invalid characters. Use alphanumeric, hyphen, or underscore only.` };
    }

    if (hasHeaderInjection(header.value)) {
      return { error: `Header value contains CR/LF characters. This is not allowed.` };
    }

    if (isReservedHeader(header.name)) {
      return { error: `Header "${header.name}" is reserved and cannot be supplied as a generic header.` };
    }
  }

  return {};
}

/**
 * Validate a provider configuration draft before save, discovery, or test.
 */
export function validateProviderConfig(options: {
  baseUrl: string;
  catalogUrl?: string;
  authType?: string;
  apiKey?: string;
  requiresApiKey?: boolean;
  headers?: Array<{ name: string; value: string; secret?: boolean }>;
}): ProviderConfigValidationResult {
  const result: ProviderConfigValidationResult = {
    valid: true,
    warnings: [],
  };

  // Validate base URL
  const baseUrlCheck = validateProviderUrl(options.baseUrl, 'base');
  if (baseUrlCheck.error) {
    result.baseUrlError = baseUrlCheck.error;
    result.valid = false;
  }
  if (baseUrlCheck.warning) {
    result.warnings.push(baseUrlCheck.warning);
  }

  // Validate catalog URL if provided
  if (options.catalogUrl) {
    const catalogUrlCheck = validateProviderUrl(options.catalogUrl, 'catalog');
    if (catalogUrlCheck.error) {
      result.catalogUrlError = catalogUrlCheck.error;
      result.valid = false;
    }
    if (catalogUrlCheck.warning) {
      result.warnings.push(catalogUrlCheck.warning);
    }
  }

  // Validate authentication
  if (options.requiresApiKey && !options.apiKey) {
    result.authenticationError = 'API key is required for this service profile';
    result.valid = false;
  }

  // Validate headers
  const headersCheck = validateProviderHeaders(options.headers);
  if (headersCheck.error) {
    result.headersError = headersCheck.error;
    result.valid = false;
  }

  return result;
}

/**
 * Redact sensitive values from a string for display (errors, logs, etc.).
 * Masks API keys and secret header values.
 */
export function redactSensitiveValue(value: string | undefined): string {
  if (!value) return '';
  if (value.length <= 4) return '***';
  return value.substring(0, 2) + '***' + value.substring(value.length - 2);
}

/**
 * Remove or redact API keys and secret header values from an error message.
 * Prevents accidental credential leakage in user-facing messages.
 */
export function sanitizeErrorMessage(message: string, apiKey?: string | undefined): string {
  let result = message;

  // Redact bare API key if present
  if (apiKey && apiKey.length > 0) {
    result = result.replace(new RegExp(apiKey, 'g'), redactSensitiveValue(apiKey));
  }

  // Redact common patterns like "Authorization: Bearer <key>"
  result = result.replace(/Bearer\s+[a-zA-Z0-9\-_\.]+/gi, `Bearer ${redactSensitiveValue('')}`);
  result = result.replace(/(api[_-]?key|x-api-key)\s*[:=]\s*[a-zA-Z0-9\-_\.]+/gi, '$1=***');

  return result;
}
