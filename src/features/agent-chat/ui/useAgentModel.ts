import { useCallback, useEffect, useState } from "react";
import { resolveSkill, DEFAULT_SKILL_ID } from "../../skills";
import { useSelectableModels } from "../../providers/ui";
import { AUTO_MODEL_ID, defaultForChats, findOpenRouterJevProvider, isAutoSelectionAvailable, resolveChatModel } from "../../providers";
import { useWorkspaceStore } from "../../../store";
import { isAutoMode, onAutoMode, setAutoMode } from "../../../harness/autoMode";
import { useChatStore } from "./chats/chatStore";

/** The shown chat's model. Each chat keeps its own choice (saved with it); a new chat starts on the
 * default model. A choice that can no longer run -- its provider was deleted, signed out or lost its
 * key, or the model left the catalogue -- falls back to the default, and the chat keeps that.
 * AUTO is offered when intelligent selection can run. */
export function useAgentModel(chatId: string, setChatModel: (model: string) => void) {
  const customProviders = useWorkspaceStore((state) => state.customProviders);
  const activeCustomProviderId = useWorkspaceStore((state) => state.activeCustomProviderId);
  const providerStatus = useWorkspaceStore((state) => state.providerStatus);
  const defaultModel = useWorkspaceStore((state) => defaultForChats(state));
  const configLoaded = useWorkspaceStore((state) => state.secureConfigLoaded);
  const settings = useWorkspaceStore((state) => state.intelligentModelSelectionSettings);
  const chatModel = useChatStore((state) => state.chats[chatId]?.model ?? "");
  const { options: baseModelOptions, unauthenticatedProviders } = useSelectableModels(customProviders, providerStatus, activeCustomProviderId);
  const autoAvailable = Boolean(findOpenRouterJevProvider(customProviders, settings.jevModelId));

  const autoOffered = useCallback(
    () => isAutoSelectionAvailable({ customProviders, providerStatus, activeCustomProviderId, intelligentModelSelectionSettings: settings }),
    [activeCustomProviderId, customProviders, settings, providerStatus],
  );

  const modelFor = useCallback(
    (model: string | undefined) => resolveChatModel(model, defaultModel, customProviders, providerStatus, autoOffered()),
    [autoOffered, customProviders, defaultModel, providerStatus],
  );
  const selectedModel = modelFor(chatModel);

  // The chat's own choice cannot run any more: it moves to the default and keeps it. Not before the
  // saved configuration (provider keys) has loaded, when every model would look unusable.
  useEffect(() => {
    if (!configLoaded || !selectedModel || selectedModel === chatModel) return;
    setChatModel(selectedModel);
  }, [chatModel, configLoaded, selectedModel, setChatModel]);

  const selectModel = (model: string) => setChatModel(model);

  const options = autoOffered() ? [{ id: AUTO_MODEL_ID, name: "AUTO — Intelligent model selection" }, ...baseModelOptions] : baseModelOptions;
  const placeholder = baseModelOptions.length === 0 && unauthenticatedProviders.length > 0
    ? `Sign in to ${unauthenticatedProviders.map((p) => p.name).join(", ")} to see more models`
    : "Select model";

  return { selectedModel, selectModel, modelFor, options, placeholder, autoAvailable, intelligentModelSelectionSettings: settings };
}

/** The Agent tab's skill: always one that exists. Resolution order: the
 * store's active skill, then Build (the default), then the first available. */
export function useSkillChoice() {
  const skills = useWorkspaceStore((state) => state.skills);
  const activeSkillId = useWorkspaceStore((state) => state.activeSkillId);
  const setActiveSkill = useWorkspaceStore((state) => state.setActiveSkill);
  const [selectedSkillId, setSelectedSkillId] = useState<string>(activeSkillId || DEFAULT_SKILL_ID);

  useEffect(() => {
    const nextId = resolveSkill(skills, activeSkillId || selectedSkillId)?.id ?? null;
    if (!nextId) return;
    if (selectedSkillId !== nextId) setSelectedSkillId(nextId);
    if (activeSkillId !== nextId) setActiveSkill(nextId);
  }, [activeSkillId, selectedSkillId, setActiveSkill, skills]);

  const selectSkill = (id: string) => {
    if (!id) return;
    setSelectedSkillId(id);
    setActiveSkill(id);
  };
  const hasSelectedSkill = selectedSkillId !== null && skills.some((skill) => skill.id === selectedSkillId);
  const options = skills.filter((s) => !s.isInternal).map((s) => ({ id: s.id, name: s.name }));
  return { selectedSkillId, selectSkill, hasSelectedSkill, options };
}

/** Auto mode (harness/autoMode.ts): nothing waits for the user. One switch for the whole app; a
 * workflow run started while it is on also passes its approval steps itself. */
export function useAutoMode(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(isAutoMode);
  useEffect(() => onAutoMode(setEnabled), []);
  return [enabled, setAutoMode];
}
