// ============================================================
// catalogModels.ts — Turns a provider's raw model-catalog response into
// the ProviderModels providerCatalog.ts returns. How each provider's
// entries say whether a model is usable, reasons, or reads images is a
// rule here, so a provider quirk lands in one place.
// ============================================================

import type { CustomProvider, ProviderModel } from "../../../store/types";
import { isMistralUrl, normalizeApiType } from "./directExecution";
import { PROVIDER_DEFAULTS, providerBaseUrl, trimTrailingSlash } from "./catalogProviders";

/** What every entry in one provider's catalog shares. */
export interface CatalogModelContext {
  providerId: string;
  baseUrl: string;
  apiType: string;
  isMistral: boolean;
}

export function catalogModelContext(provider: CustomProvider): CatalogModelContext {
  const baseUrl = trimTrailingSlash(providerBaseUrl(provider));
  const isMistral = isMistralUrl(baseUrl);
  return {
    providerId: provider.id,
    baseUrl,
    apiType: isMistral ? "mistral-conversations" : normalizeApiType(provider.apiType || PROVIDER_DEFAULTS[provider.id]?.apiType),
    isMistral,
  };
}

export function rawModelsFromPayload(payload: unknown): any[] {
  if (Array.isArray(payload)) return payload;
  const record = payload as { data?: unknown; models?: unknown } | null;
  if (Array.isArray(record?.data)) return record.data;
  if (Array.isArray(record?.models)) return record.models;
  throw new Error("The provider returned an unsupported model-catalog format.");
}

/** `a || b || c`: the first truthy value, else the last one. */
function firstTruthy<T>(...values: T[]): T {
  return values.find(Boolean) ?? values[values.length - 1];
}

function modelDisplayName(raw: any, remoteId: string): string {
  return firstTruthy(raw?.friendly_name, raw?.display_name, raw?.name, remoteId.split("/").pop(), remoteId);
}

function githubModelSupported(raw: any): boolean {
  const capabilities = Array.isArray(raw?.capabilities) ? raw.capabilities : [];
  const output = Array.isArray(raw?.supported_output_modalities) ? raw.supported_output_modalities : ["text"];
  return capabilities.includes("tool-calling") && output.includes("text");
}

function openRouterModelSupported(raw: any): boolean {
  if (Array.isArray(raw?.architecture?.output_modalities)) {
    return raw.architecture.output_modalities.includes("text");
  }
  if (typeof raw?.architecture?.modality === "string") {
    return raw.architecture.modality.endsWith("->text");
  }
  return true;
}

function openAiModelSupported(remoteId: string): boolean {
  const id = remoteId.toLowerCase();
  if (/(audio|realtime|transcrib|tts|image|embedding|moderation|whisper|dall-e|sora|search-preview)/.test(id)) {
    return false;
  }
  return /^(gpt-|o\d(?:-|$)|codex-)/.test(id);
}

/** Mistral lists embedding, OCR and moderation models too. */
function mistralModelSupported(raw: any): boolean {
  return raw?.capabilities?.completion_chat === true && raw?.capabilities?.function_calling !== false;
}

/** Which of a provider's catalog entries can serve a chat. */
const MODEL_SUPPORT_RULES = new Map<string, (raw: any, remoteId: string) => boolean>([
  ["github-models", githubModelSupported],
  ["openai", (_raw, remoteId) => openAiModelSupported(remoteId)],
  ["openrouter", openRouterModelSupported],
  ["anthropic", () => true],
]);

function modelSupported(context: CatalogModelContext, raw: any, remoteId: string): boolean {
  const rule = MODEL_SUPPORT_RULES.get(context.providerId);
  if (rule) return rule(raw, remoteId);
  if (context.isMistral) return mistralModelSupported(raw);
  return true;
}

const REASONING_PARAMETERS = ["reasoning", "include_reasoning"];

function modelReasoning(context: CatalogModelContext, raw: any, remoteId: string): boolean {
  if (context.providerId === "openai") return /^(gpt-5|o\d(?:-|$))/.test(remoteId.toLowerCase());
  if (raw?.capabilities?.thinking?.supported === true) return true;
  const parameters = raw?.supported_parameters;
  return Array.isArray(parameters) && REASONING_PARAMETERS.some((name) => parameters.includes(name));
}

function advertisesImageInput(context: CatalogModelContext, raw: any): boolean {
  if (raw?.capabilities?.image_input?.supported === true) return true;
  return context.isMistral && raw?.capabilities?.vision === true;
}

function modelInput(context: CatalogModelContext, raw: any, supported: boolean): Array<"text" | "image"> {
  if (context.providerId === "openai" && supported) return ["text", "image"];
  if (advertisesImageInput(context, raw)) return ["text", "image"];
  return (raw?.architecture?.input_modalities || raw?.supported_input_modalities || ["text"])
    .filter((item: string) => item === "text" || item === "image");
}

/** Extract output modalities from OpenRouter raw model metadata. */
function extractOutputModalities(raw: any): string[] | undefined {
  if (Array.isArray(raw?.architecture?.output_modalities)) {
    return raw.architecture.output_modalities;
  }
  if (typeof raw?.architecture?.modality === "string") {
    // Modality format: "text->text", "text->decisions", etc.
    const parts = raw.architecture.modality.split("->");
    return parts.length > 1 ? [parts[parts.length - 1]] : undefined;
  }
  return undefined;
}

function providerModelId(providerId: string, remoteId: string): string {
  return `${providerId}/${remoteId}`;
}

function toProviderModel(context: CatalogModelContext, raw: any): ProviderModel | null {
  const remoteId = String(firstTruthy(raw?.id, raw?.key, raw?.name, "")).trim();
  if (!remoteId) return null;
  const supported = modelSupported(context, raw, remoteId);
  return {
    id: providerModelId(context.providerId, remoteId),
    remoteId,
    name: modelDisplayName(raw, remoteId),
    apiType: context.apiType,
    baseUrl: context.baseUrl,
    supported,
    capabilities: Array.isArray(raw?.capabilities) ? raw.capabilities.map(String) : [],
    outputModalities: context.providerId === "openrouter" ? extractOutputModalities(raw) : undefined,
    reasoning: modelReasoning(context, raw, remoteId),
    input: modelInput(context, raw, supported),
    contextWindow: firstTruthy(raw?.context_length, raw?.limits?.max_input_tokens, raw?.max_input_tokens, raw?.max_context_length),
    maxTokens: firstTruthy(raw?.top_provider?.max_completion_tokens, raw?.limits?.max_output_tokens, raw?.max_tokens),
  };
}

/** Usable models first, then by name. */
export function toProviderModels(rawModels: any[], context: CatalogModelContext): ProviderModel[] {
  return rawModels
    .map((raw: any) => toProviderModel(context, raw))
    .filter((model): model is ProviderModel => model !== null)
    .sort((a, b) => Number(b.supported) - Number(a.supported) || a.name.localeCompare(b.name));
}
