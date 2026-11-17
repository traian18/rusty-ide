// Which model a chat runs on. The user sets one default model in the LLM
// setup (`activeModel` in the store), across every connected provider. A new
// chat starts on it; each chat then keeps its own choice, saved with the
// conversation. A choice whose provider was deleted, signed out or lost its
// key (or whose model left the catalogue) is no longer usable, and the chat
// falls back to the default; a default that is unusable too falls back to the
// first model a connected provider offers.
//
// With JEV set up (OpenRouter connected, intelligent selection on, a model for
// every level), AUTO can be the default too. Features that cannot run AUTO
// (inline chat, canvas, wiki, background docs) read `concreteDefaultModel`,
// which stands in the Standard level's model for it.

import type { CustomProvider, ProviderStatus } from "../../../store/types";
import { providerStatusOrUnknown } from "../integrations/registryTypes";
import { AUTO_MODEL_ID, findOpenRouterJevProvider, resolveLevelCandidates } from "./intelligentModelSelector";
import type { IntelligentModelSelectionSettings } from "./intelligentModelSelectionTypes";
import { baseModelReference, isManagedAuthProvider, providerHasModelReference, selectableProviderModels } from "./providerHelpers";

/** The provider `modelReference` belongs to, if it still exists. */
export function providerOfModel(modelReference: string, providers: CustomProvider[]): CustomProvider | undefined {
  const base = baseModelReference(modelReference);
  return providers.find((provider) => base.startsWith(`${provider.id}/`))
    ?? providers.find((provider) => providerHasModelReference(provider, modelReference));
}

/** Whether a provider is connected: a managed one not known to be signed out (still checking counts), any other with a key or no auth. */
export function isProviderConnected(provider: CustomProvider, providerStatus: Record<string, ProviderStatus>): boolean {
  if (isManagedAuthProvider(provider)) return providerStatusOrUnknown(providerStatus, provider.id).kind !== "unauthenticated";
  return provider.authType === "none" || Boolean(provider.apiKey?.trim());
}

/**
 * Whether a concrete model can still be run: its provider exists and is
 * connected, and the model is in that provider's catalogue (a provider whose
 * catalogue has not loaded yet is given the benefit of the doubt).
 */
export function isModelUsable(
  modelReference: string,
  providers: CustomProvider[],
  providerStatus: Record<string, ProviderStatus>,
): boolean {
  if (!modelReference || modelReference === AUTO_MODEL_ID) return false;
  const provider = providerOfModel(modelReference, providers);
  if (!provider || !isProviderConnected(provider, providerStatus)) return false;
  return provider.models.length === 0 || providerHasModelReference(provider, modelReference);
}

/** What deciding AUTO's availability and the default model reads from the store. */
export interface DefaultModelState {
  activeModel: string;
  customProviders: CustomProvider[];
  providerStatus: Record<string, ProviderStatus>;
  activeCustomProviderId: string | null;
  intelligentModelSelectionSettings: IntelligentModelSelectionSettings;
}

/** Whether AUTO can run: intelligent selection is on, OpenRouter's JEV is connected, and every level has a usable model. */
export function isAutoSelectionAvailable(state: Omit<DefaultModelState, "activeModel">): boolean {
  const settings = state.intelligentModelSelectionSettings;
  if (!settings?.enabled || !findOpenRouterJevProvider(state.customProviders, settings.jevModelId)) return false;
  return resolveLevelCandidates(state.customProviders, state.providerStatus, state.activeCustomProviderId, settings.levelModels).missing.length === 0;
}

/** The model a new chat starts on: the default when it can run (AUTO while available), else the first model of a connected provider, else none. */
export function defaultChatModel(
  defaultModel: string,
  providers: CustomProvider[],
  providerStatus: Record<string, ProviderStatus>,
  autoAvailable = false,
): string {
  if (defaultModel === AUTO_MODEL_ID && autoAvailable) return AUTO_MODEL_ID;
  if (isModelUsable(defaultModel, providers, providerStatus)) return defaultModel;
  return selectableProviderModels(providers, providerStatus, null)[0]?.model.id ?? "";
}

/** The default model for a feature that cannot run AUTO: the default itself, or with AUTO the Standard level's model. */
export function concreteDefaultModel(state: DefaultModelState): string {
  if (state.activeModel !== AUTO_MODEL_ID) return state.activeModel;
  const levels = state.intelligentModelSelectionSettings?.levelModels;
  const standard = levels ? resolveLevelCandidates(state.customProviders, state.providerStatus, state.activeCustomProviderId, levels).candidates.standard : undefined;
  return standard?.model.id ?? defaultChatModel("", state.customProviders, state.providerStatus);
}

/** The default as chats see it: AUTO while it is the default and can run; otherwise the concrete
 * default (with AUTO the default but unable to run, the same stand-in other features use). */
export function defaultForChats(state: DefaultModelState): string {
  if (state.activeModel === AUTO_MODEL_ID && isAutoSelectionAvailable(state)) return AUTO_MODEL_ID;
  return concreteDefaultModel(state);
}

/** The model a chat runs on: its own choice while usable (AUTO while intelligent selection can run), else the default. */
export function resolveChatModel(
  chatModel: string | undefined,
  defaultModel: string,
  providers: CustomProvider[],
  providerStatus: Record<string, ProviderStatus>,
  autoAvailable: boolean,
): string {
  if (chatModel === AUTO_MODEL_ID && autoAvailable) return AUTO_MODEL_ID;
  if (chatModel && isModelUsable(chatModel, providers, providerStatus)) return chatModel;
  return defaultChatModel(defaultModel, providers, providerStatus, autoAvailable);
}

/** Whether `providerId` is one of the providers the app ships with (it cannot be removed, only reset). */
export function isBuiltInProvider(providerId: string, defaults: CustomProvider[]): boolean {
  return defaults.some((provider) => provider.id === providerId);
}

/**
 * The providers after deleting `providerId`: one the user added is removed; a built-in one is put
 * back to how it ships (its key, headers and discovered catalogue cleared), since built-ins always
 * come back on the next start. Also says which provider is selected next and what the default model
 * becomes when it belonged to the deleted provider.
 */
export function afterProviderDelete(
  providers: CustomProvider[],
  providerId: string,
  defaults: CustomProvider[],
  selectedProviderId: string | null,
  defaultModel: string,
  providerStatus: Record<string, ProviderStatus>,
): { providers: CustomProvider[]; selectedProviderId: string | null; defaultModel: string } {
  const shipped = defaults.find((provider) => provider.id === providerId);
  const next = shipped
    ? providers.map((provider) => provider.id === providerId ? structuredClone(shipped) : provider)
    : providers.filter((provider) => provider.id !== providerId);
  const selected = selectedProviderId === providerId && !shipped ? next[0]?.id ?? null : selectedProviderId;
  const ownedDefault = providerOfModel(defaultModel, providers)?.id === providerId;
  return {
    providers: next,
    selectedProviderId: selected,
    defaultModel: ownedDefault ? defaultChatModel("", next, providerStatus) : defaultModel,
  };
}
