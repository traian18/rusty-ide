import { describe, it, expect } from 'vitest';
import {
  inferProfileFromApiType,
  getApiTypeForProfile,
  getAuthTypeForProfile,
  profileRequiresApiKey,
  getPreset,
  getAvailablePresets,
  isPresetDirectExecutionAvailable,
  getPresetDirectExecutionUnavailableReason,
  PRESETS,
  PROFILES,
} from './providerConnectionProfiles';

describe('providerConnectionProfiles', () => {
  describe('presets', () => {
    it('has required presets defined', () => {
      expect(PRESETS['openai']).toBeDefined();
      expect(PRESETS['openai-compatible']).toBeDefined();
      expect(PRESETS['ollama']).toBeDefined();
      expect(PRESETS['vllm']).toBeDefined();
      expect(PRESETS['openrouter']).toBeDefined();
      expect(PRESETS['opencode-zen']).toBeDefined();
      expect(PRESETS['advanced']).toBeDefined();
    });

    it('sets correct defaults for ollama', () => {
      const preset = PRESETS['ollama'];
      expect(preset.defaultBaseUrl).toBe('http://localhost:11434/v1');
      expect(preset.authType).toBe('none');
      expect(preset.apiType).toBe('openai-completions');
    });

    it('sets correct defaults for vllm', () => {
      const preset = PRESETS['vllm'];
      expect(preset.defaultBaseUrl).toBe('http://localhost:8000/v1');
      expect(preset.authType).toBe('none');
      expect(preset.apiType).toBe('openai-completions');
    });

    it('sets correct defaults for openrouter', () => {
      const preset = PRESETS['openrouter'];
      expect(preset.defaultBaseUrl).toBe('https://openrouter.ai/api/v1');
      expect(preset.authType).toBe('bearer');
      expect(preset.apiType).toBe('openai-completions');
    });

    it('marks opencode-zen as direct-execution unavailable', () => {
      const preset = PRESETS['opencode-zen'];
      expect(preset.directExecutionAvailable).toBe(false);
      expect(preset.directExecutionUnavailableReason).toContain('CORS');
    });

    it('sets openai-compatible as default generic choice', () => {
      const preset = PRESETS['openai-compatible'];
      expect(preset.apiType).toBe('openai-completions');
      expect(preset.authType).toBe('none');
    });

    it('openai preset uses openai-responses profile', () => {
      const preset = PRESETS['openai'];
      expect(preset.profile).toBe('openai-responses');
      expect(preset.apiType).toBe('openai-responses');
    });
  });

  describe('inferProfileFromApiType', () => {
    it('infers openai-responses from apiType openai or openai-responses', () => {
      expect(inferProfileFromApiType('openai')).toBe('openai-responses');
      expect(inferProfileFromApiType('openai-responses')).toBe('openai-responses');
      expect(inferProfileFromApiType('OPENAI')).toBe('openai-responses');
    });

    it('infers anthropic-messages from apiType anthropic or anthropic-messages', () => {
      expect(inferProfileFromApiType('anthropic')).toBe('anthropic-messages');
      expect(inferProfileFromApiType('anthropic-messages')).toBe('anthropic-messages');
    });

    it('defaults to openai-compatible for unknown apiTypes', () => {
      expect(inferProfileFromApiType('unknown')).toBe('openai-compatible');
      expect(inferProfileFromApiType(undefined)).toBe('openai-compatible');
      expect(inferProfileFromApiType('')).toBe('openai-compatible');
    });

    it('normalizes underscores to hyphens', () => {
      expect(inferProfileFromApiType('openai_responses')).toBe('openai-responses');
      expect(inferProfileFromApiType('anthropic_messages')).toBe('anthropic-messages');
    });
  });

  describe('profile helpers', () => {
    it('getApiTypeForProfile returns correct api type', () => {
      expect(getApiTypeForProfile('openai-compatible')).toBe('openai-completions');
      expect(getApiTypeForProfile('openai-responses')).toBe('openai-responses');
      expect(getApiTypeForProfile('anthropic-messages')).toBe('anthropic-messages');
    });

    it('getAuthTypeForProfile returns correct auth type', () => {
      expect(getAuthTypeForProfile('openai-compatible')).toBe('none');
      expect(getAuthTypeForProfile('openai-responses')).toBe('bearer');
      expect(getAuthTypeForProfile('anthropic-messages')).toBe('anthropic');
    });

    it('profileRequiresApiKey returns correct value', () => {
      expect(profileRequiresApiKey('openai-compatible')).toBe(false);
      expect(profileRequiresApiKey('openai-responses')).toBe(true);
      expect(profileRequiresApiKey('anthropic-messages')).toBe(true);
    });
  });

  describe('preset retrieval', () => {
    it('getPreset returns preset metadata', () => {
      const preset = getPreset('ollama');
      expect(preset.id).toBe('ollama');
      expect(preset.label).toBe('Ollama');
    });

    it('getAvailablePresets returns all except advanced by default', () => {
      const presets = getAvailablePresets();
      expect(presets.length).toBe(6); // all but advanced
      expect(presets.some(p => p.id === 'advanced')).toBe(false);
    });

    it('getAvailablePresets includes advanced when requested', () => {
      const presets = getAvailablePresets(true);
      expect(presets.some(p => p.id === 'advanced')).toBe(true);
    });
  });

  describe('direct execution availability', () => {
    it('isPresetDirectExecutionAvailable returns true for most presets', () => {
      expect(isPresetDirectExecutionAvailable('ollama')).toBe(true);
      expect(isPresetDirectExecutionAvailable('vllm')).toBe(true);
      expect(isPresetDirectExecutionAvailable('openai')).toBe(true);
    });

    it('isPresetDirectExecutionAvailable returns false for opencode-zen', () => {
      expect(isPresetDirectExecutionAvailable('opencode-zen')).toBe(false);
    });

    it('getPresetDirectExecutionUnavailableReason returns reason only for unavailable presets', () => {
      expect(getPresetDirectExecutionUnavailableReason('ollama')).toBeUndefined();
      expect(getPresetDirectExecutionUnavailableReason('opencode-zen')).toContain('CORS');
    });
  });

  describe('profiles', () => {
    it('has all required profiles defined', () => {
      expect(PROFILES['openai-compatible']).toBeDefined();
      expect(PROFILES['openai-responses']).toBeDefined();
      expect(PROFILES['anthropic-messages']).toBeDefined();
    });

    it('defines requiresApiKey correctly', () => {
      expect(PROFILES['openai-compatible'].requiresApiKey).toBe(false);
      expect(PROFILES['openai-responses'].requiresApiKey).toBe(true);
      expect(PROFILES['anthropic-messages'].requiresApiKey).toBe(true);
    });
  });
});
