export interface ProviderModel {
  id: string;
  name: string;
  remoteId?: string;
  apiType?: string;
  baseUrl?: string;
  supported?: boolean;
  capabilities?: string[];
  /** Output modalities advertised by the provider catalog (for example text, image, or decisions). */
  outputModalities?: string[];
  reasoning?: boolean;
  reasoningEffort?: ReasoningEffort;
  supportedReasoningEfforts?: ReasoningEffort[];
  defaultReasoningEffort?: ReasoningEffort;
  thinkingLevelMap?: Record<string, string | null>;
  thinkingBudgets?: Record<string, number>;
  input?: Array<"text" | "image">;
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  compat?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface CustomProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  apiType: string;
  /** Subscription providers use their official local runtimes instead of Pi's HTTP adapters. */
  transport?: "http" | "github-copilot-sdk" | "openai-codex-app-server";
  authType?: "bearer" | "anthropic" | "none" | "environment";
  catalogUrl?: string;
  models: ProviderModel[];
  /** ISO timestamp of the last successful discoverModels() call for this
      provider (REFACTOR_PLAN.md PR 3b). Absent means "never discovered" --
      what lets createIntegrationSlice's load-time merge stop conflating
      that with "discovered and legitimately empty" (a saved empty models
      array used to always fall back to the hardcoded defaults). Optional,
      so no PROVIDER_CONFIG_VERSION bump was needed to add it. */
  modelsFetchedAt?: string;
}
