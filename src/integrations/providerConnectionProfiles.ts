/**
 * Provider connection profiles and presets for OpenAI-compatible service integration.
 * Centrally defines supported service configurations, authentication, defaults, and limitations.
 */

export type ProfileId = 
  | 'openai-compatible'
  | 'openai-responses'
  | 'anthropic-messages';

export type PresetId = 
  | 'openai'
  | 'openai-compatible'
  | 'ollama'
  | 'vllm'
  | 'openrouter'
  | 'opencode-zen'
  | 'advanced';

export type ApiType = 'openai-completions' | 'openai-responses' | 'anthropic-messages';
export type AuthType = 'bearer' | 'anthropic' | 'none';

/**
 * Preset metadata for a service or connection type.
 */
export interface PresetMetadata {
  id: PresetId;
  label: string;
  description: string;
  defaultDisplayName: string;
  defaultBaseUrl: string;
  apiType: ApiType;
  authType: AuthType;
  profile: ProfileId;
  supportsModelDiscovery: boolean;
  directExecutionAvailable: boolean;
  directExecutionUnavailableReason?: string;
  preset?: {
    headers?: Record<string, string>;
    catalogUrl?: string;
  };
}

/**
 * Profile metadata defining a protocol/API compatibility.
 */
export interface ProfileMetadata {
  id: ProfileId;
  label: string;
  apiType: ApiType;
  authType: AuthType;
  requiresApiKey: boolean;
}

/**
 * Preset definitions with all metadata.
 */
export const PRESETS: Record<PresetId, PresetMetadata> = {
  'openai': {
    id: 'openai',
    label: 'OpenAI',
    description: 'Official OpenAI API with GPT models and advanced features',
    defaultDisplayName: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    apiType: 'openai-responses',
    authType: 'bearer',
    profile: 'openai-responses',
    supportsModelDiscovery: true,
    directExecutionAvailable: true,
  },
  'openai-compatible': {
    id: 'openai-compatible',
    label: 'OpenAI-Compatible API',
    description: 'Any service implementing OpenAI Chat Completions protocol',
    defaultDisplayName: 'OpenAI-Compatible Service',
    defaultBaseUrl: 'http://localhost:8000/v1',
    apiType: 'openai-completions',
    authType: 'none',
    profile: 'openai-compatible',
    supportsModelDiscovery: true,
    directExecutionAvailable: true,
  },
  'ollama': {
    id: 'ollama',
    label: 'Ollama',
    description: 'Local Ollama model inference server',
    defaultDisplayName: 'Ollama',
    defaultBaseUrl: 'http://localhost:11434/v1',
    apiType: 'openai-completions',
    authType: 'none',
    profile: 'openai-compatible',
    supportsModelDiscovery: true,
    directExecutionAvailable: true,
  },
  'vllm': {
    id: 'vllm',
    label: 'vLLM',
    description: 'vLLM high-throughput LLM inference server',
    defaultDisplayName: 'vLLM',
    defaultBaseUrl: 'http://localhost:8000/v1',
    apiType: 'openai-completions',
    authType: 'none',
    profile: 'openai-compatible',
    supportsModelDiscovery: true,
    directExecutionAvailable: true,
  },
  'openrouter': {
    id: 'openrouter',
    label: 'OpenRouter',
    description: 'OpenRouter aggregated model marketplace',
    defaultDisplayName: 'OpenRouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    apiType: 'openai-completions',
    authType: 'bearer',
    profile: 'openai-compatible',
    supportsModelDiscovery: true,
    directExecutionAvailable: true,
  },
  'opencode-zen': {
    id: 'opencode-zen',
    label: 'OpenCode Zen',
    description: 'OpenCode Zen inference service (browser direct execution unavailable)',
    defaultDisplayName: 'OpenCode Zen',
    defaultBaseUrl: 'https://api.zen.opencode.dev/v1',
    apiType: 'openai-completions',
    authType: 'bearer',
    profile: 'openai-compatible',
    supportsModelDiscovery: true,
    directExecutionAvailable: false,
    directExecutionUnavailableReason: 'OpenCode Zen endpoints do not authorize the Rusty browser origin due to CORS restrictions. Use catalog discovery to fetch available models, or configure a proxy/sidecar.',
  },
  'advanced': {
    id: 'advanced',
    label: 'Advanced Profile',
    description: 'Explicitly supported OpenAI Responses or Anthropic Messages configurations',
    defaultDisplayName: 'Advanced Service',
    defaultBaseUrl: '',
    apiType: 'openai-completions',
    authType: 'none',
    profile: 'openai-compatible',
    supportsModelDiscovery: false,
    directExecutionAvailable: true,
  },
};

/**
 * Profile definitions.
 */
export const PROFILES: Record<ProfileId, ProfileMetadata> = {
  'openai-compatible': {
    id: 'openai-compatible',
    label: 'OpenAI Chat Completions',
    apiType: 'openai-completions',
    authType: 'none',
    requiresApiKey: false,
  },
  'openai-responses': {
    id: 'openai-responses',
    label: 'OpenAI Responses',
    apiType: 'openai-responses',
    authType: 'bearer',
    requiresApiKey: true,
  },
  'anthropic-messages': {
    id: 'anthropic-messages',
    label: 'Anthropic Messages',
    apiType: 'anthropic-messages',
    authType: 'anthropic',
    requiresApiKey: true,
  },
};

/**
 * Map an existing apiType to a profile ID.
 * Handles legacy values and defaults sensibly.
 */
export function inferProfileFromApiType(apiType?: string): ProfileId {
  if (!apiType) return 'openai-compatible';
  
  const normalized = apiType.toLowerCase().replace(/_/g, '-');
  
  if (normalized === 'openai-responses' || normalized === 'openai') {
    return 'openai-responses';
  }
  if (normalized === 'anthropic-messages' || normalized === 'anthropic') {
    return 'anthropic-messages';
  }
  // Default to openai-compatible for unknown values
  return 'openai-compatible';
}

/**
 * Map a profile ID to its primary API type.
 */
export function getApiTypeForProfile(profile: ProfileId): ApiType {
  return PROFILES[profile].apiType;
}

/**
 * Map a profile ID to its required auth type.
 */
export function getAuthTypeForProfile(profile: ProfileId): AuthType {
  return PROFILES[profile].authType;
}

/**
 * Check if a profile requires an API key.
 */
export function profileRequiresApiKey(profile: ProfileId): boolean {
  return PROFILES[profile].requiresApiKey;
}

/**
 * Get preset metadata by ID.
 */
export function getPreset(id: PresetId): PresetMetadata {
  return PRESETS[id];
}

/**
 * Get all available presets (except 'advanced' if not explicitly requested).
 */
export function getAvailablePresets(includeAdvanced = false): PresetMetadata[] {
  return Object.values(PRESETS).filter(p => includeAdvanced || p.id !== 'advanced');
}

/**
 * Check if a preset allows direct browser execution.
 */
export function isPresetDirectExecutionAvailable(presetId: PresetId): boolean {
  return PRESETS[presetId].directExecutionAvailable;
}

/**
 * Get the direct execution unavailability reason for a preset, if any.
 */
export function getPresetDirectExecutionUnavailableReason(presetId: PresetId): string | undefined {
  return PRESETS[presetId].directExecutionUnavailableReason;
}
