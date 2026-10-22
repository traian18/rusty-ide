import type { CustomProvider } from "../../../store";
import type { ProviderHeader } from "../../../store/types";
import { providerModelVariants } from "../../../store/providerHelpers";
import {
  validateProviderConfig,
  type ProviderConfigValidationResult,
} from "../../../integrations/providerConnectionValidation";

/** Whether the edited provider can be saved, and the warnings to show for it. */
export function validateDraft(draft: CustomProvider): ProviderConfigValidationResult {
  return validateProviderConfig({
    baseUrl: draft.baseUrl || "",
    catalogUrl: draft.catalogUrl || undefined,
    authType: draft.authType || "none",
    apiKey: draft.apiKey || undefined,
    headers: draft.headers,
    // requiresApiKey is determined by the profile but handled within validateProviderConfig
  });
}

const AUTH_PLACEHOLDERS: Record<string, string> = {
  none: "This provider does not require a key",
  bearer: "Enter your Bearer Token",
  anthropic: "Enter your x-api-key",
  github: "GitHub PAT with models:read scope (or use GITHUB_TOKEN)",
};

export function authPlaceholder(authType?: string): string {
  return AUTH_PLACEHOLDERS[authType ?? ""] ?? "Enter your API Key / Auth Token";
}

export function withHeaderAdded(draft: CustomProvider): CustomProvider {
  return { ...draft, headers: [...(draft.headers || []), { name: "", value: "", secret: false }] };
}

export function withHeaderChanged<K extends keyof ProviderHeader>(
  draft: CustomProvider,
  index: number,
  field: K,
  value: ProviderHeader[K],
): CustomProvider {
  if (!draft.headers) return draft;
  const headers = [...draft.headers];
  headers[index] = { ...headers[index], [field]: value };
  return { ...draft, headers };
}

export function withHeaderRemoved(draft: CustomProvider, index: number): CustomProvider {
  if (!draft.headers) return draft;
  return { ...draft, headers: draft.headers.filter((_, i) => i !== index) };
}

export function withToolCalling(draft: CustomProvider, enabled: boolean): CustomProvider {
  return { ...draft, capabilities: { ...draft.capabilities, tools: enabled ? "enabled" : "disabled" } };
}

/** The Default Target Model choices: every supported model, once per reasoning effort. */
export function modelOptions(provider: CustomProvider) {
  return provider.models
    .filter((model) => model.supported !== false)
    .flatMap(providerModelVariants)
    .map((model) => ({ id: model.id, name: `${model.name} (${model.remoteId || model.id})` }));
}
