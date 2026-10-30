import { describe, it, expect } from 'vitest';
import { constructProviderHeaders, getRedactedHeaders } from './providerConnectionHeaders';

describe('providerConnectionHeaders', () => {
  describe('constructProviderHeaders', () => {
    it('includes base headers (Accept, Content-Type)', () => {
      const provider = {
        id: 'test',
        apiKey: '',
        authType: 'none' as const,
      };

      const headers = constructProviderHeaders({ provider });
      expect(headers['Accept']).toBe('application/json');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('includes bearer auth when apiKey is present', () => {
      const provider = {
        id: 'test',
        apiKey: 'sk-secret-key-123',
        authType: 'bearer' as const,
      };

      const headers = constructProviderHeaders({ provider });
      expect(headers['Authorization']).toBe('Bearer sk-secret-key-123');
    });

    it('includes anthropic auth headers', () => {
      const provider = {
        id: 'test',
        apiKey: 'sk-ant-secret-key',
        authType: 'anthropic' as const,
      };

      const headers = constructProviderHeaders({ provider });
      expect(headers['x-api-key']).toBe('sk-ant-secret-key');
      expect(headers['anthropic-version']).toBe('2023-06-01');
    });

    it('includes provider-level headers', () => {
      const provider = {
        id: 'test',
        apiKey: '',
        authType: 'none' as const,
        headers: [
          { name: 'x-custom-header', value: 'custom-value', secret: false },
        ],
      };

      const headers = constructProviderHeaders({ provider });
      expect(headers['x-custom-header']).toBe('custom-value');
    });

    it('filters out reserved headers from provider headers', () => {
      const provider = {
        id: 'test',
        apiKey: 'test-key',
        authType: 'bearer' as const,
        headers: [
          { name: 'authorization', value: 'Bearer fake-token', secret: true },
          { name: 'x-custom', value: 'allowed', secret: false },
        ],
      };

      const headers = constructProviderHeaders({ provider });
      // The auth headers should be set by protocol, not from provider headers
      expect(headers['Authorization']).toBe('Bearer test-key');
      expect(headers['x-custom']).toBe('allowed');
    });

    it('includes per-model legacy headers', () => {
      const provider = {
        id: 'test',
        apiKey: '',
        authType: 'none' as const,
      };

      const model = {
        headers: {
          'x-model-param': 'model-specific-value',
        },
      };

      const headers = constructProviderHeaders({ provider, model });
      expect(headers['x-model-param']).toBe('model-specific-value');
    });

    it('respects header precedence: base → preset → provider → model → auth', () => {
      const provider = {
        id: 'test',
        apiKey: 'test-key',
        authType: 'bearer' as const,
        headers: [
          { name: 'x-header', value: 'from-provider', secret: false },
        ],
      };

      const model = {
        headers: {
          'x-header': 'from-model',
        },
      };

      const headers = constructProviderHeaders({ provider, model });
      // Model headers should override provider headers (model comes after provider in precedence)
      expect(headers['x-header']).toBe('from-model');
    });

    it('allows OpenAI-compatible without API key', () => {
      const provider = {
        id: 'ollama',
        apiKey: '',
        authType: 'none' as const,
      };

      const headers = constructProviderHeaders({ provider });
      expect(headers['Authorization']).toBeUndefined();
      expect(headers['x-api-key']).toBeUndefined();
      // But base headers should still be present
      expect(headers['Accept']).toBe('application/json');
    });
  });

  describe('getRedactedHeaders', () => {
    it('redacts Authorization header', () => {
      const headers = {
        'Accept': 'application/json',
        'Authorization': 'Bearer sk-1234567890abcdef',
      };

      const redacted = getRedactedHeaders(headers);
      expect(redacted['Accept']).toBe('application/json');
      expect(redacted['Authorization']).not.toContain('1234567890');
      expect(redacted['Authorization']).toContain('***');
    });

    it('redacts x-api-key header', () => {
      const headers = {
        'x-api-key': 'sk-ant-1234567890',
      };

      const redacted = getRedactedHeaders(headers);
      expect(redacted['x-api-key']).not.toContain('1234567890');
      expect(redacted['x-api-key']).toContain('***');
    });

    it('is case-insensitive', () => {
      const headers = {
        'AUTHORIZATION': 'Bearer secret',
        'X-API-KEY': 'api-secret',
      };

      const redacted = getRedactedHeaders(headers);
      expect(redacted['AUTHORIZATION']).toContain('***');
      expect(redacted['X-API-KEY']).toContain('***');
    });

    it('leaves non-sensitive headers unchanged', () => {
      const headers = {
        'Accept': 'application/json',
        'x-custom-header': 'my-value',
        'User-Agent': 'Rusty/1.0',
      };

      const redacted = getRedactedHeaders(headers);
      expect(redacted['Accept']).toBe('application/json');
      expect(redacted['x-custom-header']).toBe('my-value');
      expect(redacted['User-Agent']).toBe('Rusty/1.0');
    });
  });
});
