import type { CustomProvider, ProviderModel } from "../../../store";
import {
  CONNECT_SERVICE_PRESET_IDS,
  getPreset,
  type PresetId,
  type PresetMetadata,
} from "../../../integrations/providerConnectionProfiles";
import { validateProviderConfig } from "../../../integrations/providerConnectionValidation";

/** What the Connect Service form collects before the provider exists. */
export interface NewProviderDraft {
  preset: PresetId;
  name: string;
  url: string;
  apiKey: string;
  model: string;
  discoverAfterSave: boolean;
}

export const EMPTY_NEW_PROVIDER_DRAFT: NewProviderDraft = {
  preset: "openai-compatible",
  name: "",
  url: "",
  apiKey: "",
  model: "",
  discoverAfterSave: false,
};

export const SERVICE_PRESET_OPTIONS = CONNECT_SERVICE_PRESET_IDS.map((id) => ({ id, name: getPreset(id).label }));

/** Choosing a service type replaces the name and URL with that preset's defaults. */
export function withPreset(draft: NewProviderDraft, presetId: PresetId): NewProviderDraft {
  const preset = getPreset(presetId);
  return { ...draft, preset: presetId, url: preset.defaultBaseUrl, name: preset.defaultDisplayName };
}

export type NewProviderCheck =
  | { ok: false; title: string; message: string }
  | { ok: true; warnings: string[] };

/** The first problem that blocks saving the draft, or the warnings to show when it saves. */
export function checkNewProvider(draft: NewProviderDraft): NewProviderCheck {
  if (!draft.name.trim()) return { ok: false, title: "Display name required", message: "Enter a display name for this service" };
  if (!draft.url.trim()) return { ok: false, title: "Base URL required", message: "Enter the provider's API base URL" };

  const { authType } = getPreset(draft.preset);
  const validation = validateProviderConfig({
    baseUrl: draft.url.trim(),
    authType,
    apiKey: draft.apiKey,
    requiresApiKey: authType === "bearer",
  });
  if (!validation.valid) {
    const errors = [validation.baseUrlError, validation.catalogUrlError, validation.authenticationError];
    return { ok: false, title: "Configuration invalid", message: errors.filter(Boolean).join("; ") };
  }
  return { ok: true, warnings: validation.warnings };
}

/** A slug of the display name that no existing provider uses yet. */
export function uniqueProviderId(name: string, providers: CustomProvider[]): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const base = slug || `provider-${Date.now()}`;
  let id = base;
  for (let counter = 1; providers.some((provider) => provider.id === id); counter++) {
    id = `${base}-${counter}`;
  }
  return id;
}

function initialModels(providerId: string, draft: NewProviderDraft, preset: PresetMetadata): ProviderModel[] {
  const remoteId = draft.model.trim();
  if (!remoteId) return [];
  return [{
    id: `${providerId}/${remoteId}`,
    remoteId,
    name: remoteId.split("/").pop() || remoteId,
    apiType: preset.apiType,
    baseUrl: draft.url.trim(),
    supported: true,
  }];
}

/** The provider the draft describes, using its preset's protocol, auth and profile. */
export function buildNewProvider(draft: NewProviderDraft, providers: CustomProvider[]): CustomProvider {
  const preset = getPreset(draft.preset);
  const id = uniqueProviderId(draft.name, providers);
  return {
    id,
    name: draft.name.trim(),
    baseUrl: draft.url.trim(),
    apiKey: draft.apiKey,
    apiType: preset.apiType,
    authType: preset.authType,
    models: initialModels(id, draft, preset),
    profile: preset.profile,
    // Enable tools by default for known presets; custom providers default to disabled
    capabilities: { tools: CONNECT_SERVICE_PRESET_IDS.includes(draft.preset) ? "enabled" : "disabled" },
  };
}
