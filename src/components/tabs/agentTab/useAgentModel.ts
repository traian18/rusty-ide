import { useCallback, useEffect, useRef, useState } from "react";
import { resolveSkill, DEFAULT_SKILL_ID } from "../../../config/skillDefinitions";
import { useSelectableModels } from "../../../hooks/useSelectableModels";
import { loadAgentModelSelection, saveAgentModelSelection } from "../../../preferences/agentModelSelection";
import { AUTO_MODEL_ID, findOpenRouterJevProvider, resolveLevelCandidates } from "../../../services/intelligentModelSelector";
import { useWorkspaceStore } from "../../../store";
import { isAutoMode, onAutoMode, setAutoMode } from "../../../harness/autoMode";

/** The Agent tab's model choice: its own, seeded once from the global default.
 * AUTO is offered when intelligent selection can run. */
export function useAgentModel() {
  const customProviders = useWorkspaceStore((state) => state.customProviders);
  const activeCustomProviderId = useWorkspaceStore((state) => state.activeCustomProviderId);
  const providerStatus = useWorkspaceStore((state) => state.providerStatus);
  const activeModel = useWorkspaceStore((state) => state.activeModel);
  const setActiveModel = useWorkspaceStore((state) => state.setActiveModel);
  const settings = useWorkspaceStore((state) => state.intelligentModelSelectionSettings);
  const savedAgentModelRef = useRef(loadAgentModelSelection());
  const [selectedModel, setSelectedModel] = useState(() => savedAgentModelRef.current ?? activeModel);
  const { options: baseModelOptions, unauthenticatedProviders } = useSelectableModels(customProviders, providerStatus, activeCustomProviderId);
  const autoAvailable = Boolean(findOpenRouterJevProvider(customProviders, settings.jevModelId));

  const modelOptions = useCallback(() => {
    if (!settings.enabled || !findOpenRouterJevProvider(customProviders, settings.jevModelId)) return baseModelOptions;
    const { missing } = resolveLevelCandidates(customProviders, providerStatus, activeCustomProviderId, settings.levelModels);
    if (missing.length > 0) return baseModelOptions;
    return [{ id: AUTO_MODEL_ID, name: "AUTO — Intelligent model selection" }, ...baseModelOptions];
  }, [activeCustomProviderId, baseModelOptions, customProviders, settings, providerStatus]);

  // Seed Agent mode once from the global default, then retain its own choice.
  // A provider refresh must not silently swap it for the first available model.
  useEffect(() => {
    if (savedAgentModelRef.current) return;
    const nextModel = activeModel || modelOptions()[0]?.id || "";
    if (!nextModel) return;
    savedAgentModelRef.current = nextModel;
    saveAgentModelSelection(nextModel);
    setSelectedModel(nextModel);
  }, [activeCustomProviderId, activeModel, customProviders, providerStatus, settings, modelOptions]);

  const selectModel = (model: string) => {
    savedAgentModelRef.current = model;
    saveAgentModelSelection(model);
    setSelectedModel(model);
    // AUTO is an Agent-only choice; concrete choices also update the shared default.
    if (model !== AUTO_MODEL_ID) setActiveModel(model);
  };

  const available = modelOptions();
  const options = selectedModel && !available.some((option) => option.id === selectedModel)
    ? [...available, { id: selectedModel, name: `${selectedModel} (unavailable)` }]
    : available;
  const placeholder = baseModelOptions.length === 0 && unauthenticatedProviders.length > 0
    ? `Sign in to ${unauthenticatedProviders.map((p) => p.name).join(", ")} to see more models`
    : "Select model";

  return { selectedModel, selectModel, options, placeholder, autoAvailable, intelligentModelSelectionSettings: settings };
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
