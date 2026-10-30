import { describe, it, expect } from 'vitest';
import {
  validateProviderUrl,
  validateProviderHeaders,
  validateProviderConfig,
  isReservedHeader,
  redactSensitiveValue,
  sanitizeErrorMessage,
} from './providerConnectionValidation';

describe('providerConnectionValidation', () => {
  describe('validateProviderUrl', () => {
    it('rejects empty URLs', () => {
      const result = validateProviderUrl('', 'base');
      expect(result.error).toBeDefined();
    });

    it('rejects invalid URLs', () => {
      const result = validateProviderUrl('not a url', 'base');
      expect(result.error).toBeDefined();
    });

    it('accepts HTTPS URLs', () => {
      const result = validateProviderUrl('https://example.com/v1', 'base');
      expect(result.error).toBeUndefined();
      expect(result.warning).toBeUndefined();
    });

    it('accepts loopback HTTP URLs', () => {
      const result = validateProviderUrl('http://localhost:8000/v1', 'base');
      expect(result.error).toBeUndefined();
      expect(result.warning).toBeUndefined();
    });

    it('accepts 127.0.0.1 HTTP URLs', () => {
      const result = validateProviderUrl('http://127.0.0.1:11434/v1', 'base');
      expect(result.error).toBeUndefined();
      expect(result.warning).toBeUndefined();
    });

    it('accepts IPv6 loopback HTTP URLs', () => {
      const result = validateProviderUrl('http://[::1]:8000/v1', 'base');
      expect(result.error).toBeUndefined();
      expect(result.warning).toBeUndefined();
    });

    it('warns but accepts private network HTTP URLs (10.0.0.0/8)', () => {
      const result = validateProviderUrl('http://10.0.0.1:8000/v1', 'base');
      expect(result.error).toBeUndefined();
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain('unencrypted HTTP');
    });

    it('warns but accepts private network HTTP URLs (192.168.0.0/16)', () => {
      const result = validateProviderUrl('http://192.168.1.100:8000/v1', 'base');
      expect(result.error).toBeUndefined();
      expect(result.warning).toBeDefined();
    });

    it('warns but accepts private network HTTP URLs (172.16.0.0/12)', () => {
      const result = validateProviderUrl('http://172.16.0.1:8000/v1', 'base');
      expect(result.error).toBeUndefined();
      expect(result.warning).toBeDefined();
    });

    it('accepts IPv6 link-local addresses with warning', () => {
      const result = validateProviderUrl('http://[fe80::1]:8000/v1', 'base');
      expect(result.error).toBeUndefined();
      expect(result.warning).toBeDefined();
    });

    it('rejects public HTTP URLs', () => {
      const result = validateProviderUrl('http://api.example.com/v1', 'base');
      expect(result.error).toBeDefined();
      expect(result.error).toContain('HTTPS');
    });

    it('includes kind in error message', () => {
      const baseResult = validateProviderUrl('http://example.com/v1', 'base');
      const catalogResult = validateProviderUrl('http://example.com/v1', 'catalog');
      expect(baseResult.error).toContain('base');
      expect(catalogResult.error).toContain('catalog');
    });
  });

  describe('isReservedHeader', () => {
    it('identifies reserved headers', () => {
      expect(isReservedHeader('authorization')).toBe(true);
      expect(isReservedHeader('Authorization')).toBe(true);
      expect(isReservedHeader('x-api-key')).toBe(true);
      expect(isReservedHeader('X-API-KEY')).toBe(true);
      expect(isReservedHeader('anthropic-version')).toBe(true);
      expect(isReservedHeader('accept')).toBe(true);
      expect(isReservedHeader('content-type')).toBe(true);
    });

    it('allows non-reserved headers', () => {
      expect(isReservedHeader('x-custom-header')).toBe(false);
      expect(isReservedHeader('user-agent')).toBe(false);
      expect(isReservedHeader('my-header')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(isReservedHeader('Authorization')).toBe(true);
      expect(isReservedHeader('AUTHORIZATION')).toBe(true);
      expect(isReservedHeader('authorization')).toBe(true);
    });
  });

  describe('validateProviderHeaders', () => {
    it('accepts empty headers', () => {
      const result = validateProviderHeaders();
      expect(result.error).toBeUndefined();
    });

    it('rejects invalid header names', () => {
      const result = validateProviderHeaders([
        { name: 'bad header', value: 'value' },
      ]);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('invalid characters');
    });

    it('accepts valid header names', () => {
      const result = validateProviderHeaders([
        { name: 'x-custom-header', value: 'value' },
        { name: 'my_header', value: 'value' },
      ]);
      expect(result.error).toBeUndefined();
    });

    it('rejects CR/LF in header values', () => {
      const result = validateProviderHeaders([
        { name: 'x-custom', value: 'value\r\nInjected: true' },
      ]);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('CR/LF');
    });

    it('rejects reserved header names', () => {
      const result = validateProviderHeaders([
        { name: 'authorization', value: 'Bearer token' },
      ]);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('reserved');
    });
  });

  describe('validateProviderConfig', () => {
    it('accepts valid openai-compatible config', () => {
      const result = validateProviderConfig({
        baseUrl: 'http://localhost:8000/v1',
        authType: 'none',
        requiresApiKey: false,
      });
      expect(result.valid).toBe(true);
      expect(result.baseUrlError).toBeUndefined();
    });

    it('rejects config with invalid base URL', () => {
      const result = validateProviderConfig({
        baseUrl: 'http://example.com/v1',
        authType: 'none',
      });
      expect(result.valid).toBe(false);
      expect(result.baseUrlError).toBeDefined();
    });

    it('warns but accepts config with private network URL', () => {
      const result = validateProviderConfig({
        baseUrl: 'http://192.168.1.100:8000/v1',
        authType: 'none',
      });
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('rejects config with missing API key when required', () => {
      const result = validateProviderConfig({
        baseUrl: 'https://api.example.com/v1',
        authType: 'bearer',
        requiresApiKey: true,
      });
      expect(result.valid).toBe(false);
      expect(result.authenticationError).toBeDefined();
    });

    it('accepts config with API key when provided', () => {
      const result = validateProviderConfig({
        baseUrl: 'https://api.example.com/v1',
        authType: 'bearer',
        requiresApiKey: true,
        apiKey: 'sk-1234567890',
      });
      expect(result.valid).toBe(true);
      expect(result.authenticationError).toBeUndefined();
    });

    it('validates headers if provided', () => {
      const result = validateProviderConfig({
        baseUrl: 'https://api.example.com/v1',
        headers: [{ name: 'authorization', value: 'Bearer token' }],
      });
      expect(result.valid).toBe(false);
      expect(result.headersError).toBeDefined();
    });

    it('accepts valid headers', () => {
      const result = validateProviderConfig({
        baseUrl: 'https://api.example.com/v1',
        headers: [{ name: 'x-custom', value: 'value' }],
      });
      expect(result.valid).toBe(true);
      expect(result.headersError).toBeUndefined();
    });
  });

  describe('redactSensitiveValue', () => {
    it('redacts short values completely', () => {
      expect(redactSensitiveValue('sk')).toBe('***');
      expect(redactSensitiveValue('abc')).toBe('***');
    });

    it('redacts long values partially', () => {
      const result = redactSensitiveValue('sk-1234567890');
      expect(result).toBe('sk***90');
      expect(result).not.toContain('1234567890');
    });

    it('handles empty values', () => {
      expect(redactSensitiveValue('')).toBe('');
      expect(redactSensitiveValue(undefined)).toBe('');
    });
  });

  describe('sanitizeErrorMessage', () => {
    it('removes bare API key from message', () => {
      const message = 'Authentication failed with key sk-1234567890';
      const sanitized = sanitizeErrorMessage(message, 'sk-1234567890');
      expect(sanitized).not.toContain('sk-1234567890');
      expect(sanitized).toContain('***');
    });

    it('redacts Bearer token patterns', () => {
      const message = 'Request failed: Bearer sk-abcdefghij';
      const sanitized = sanitizeErrorMessage(message);
      expect(sanitized).toContain('Bearer');
      expect(sanitized).not.toContain('sk-abcdefghij');
    });

    it('redacts x-api-key patterns', () => {
      const message = 'Header validation failed: x-api-key=sk-secret-value';
      const sanitized = sanitizeErrorMessage(message);
      expect(sanitized).toContain('x-api-key');
      expect(sanitized).not.toContain('sk-secret-value');
    });

    it('is case-insensitive for pattern matching', () => {
      const message = 'Failed with API_KEY: sk-value-here';
      const sanitized = sanitizeErrorMessage(message);
      expect(sanitized).not.toContain('sk-value-here');
    });
  });
});
