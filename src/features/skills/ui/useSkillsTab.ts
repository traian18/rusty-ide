import { useEffect, useRef } from "react";
import { useWorkspaceStore, Skill } from "../../../store";
import { skillsService } from "../service/skillsService";
import { notify } from "../../notifications";
import { useSelectableModels } from "../../providers/ui";
import { resolveExecutionProvider } from "../../providers";
import { harness } from "../../../harness";
import { createRunHost } from "../../../harness/hostDefaults";
import type { RunHandle } from "../../../harness/contract";

export function useSkillsTab() {
  const skills = useWorkspaceStore((state) => state.skills);
  const addSkill = useWorkspaceStore((state) => state.addSkill);
  const updateSkill = useWorkspaceStore((state) => state.updateSkill);
  const deleteSkill = useWorkspaceStore((state) => state.deleteSkill);
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const customProviders = useWorkspaceStore((state) => state.customProviders);
  const activeCustomProviderId = useWorkspaceStore((state) => state.activeCustomProviderId);
  const providerStatus = useWorkspaceStore((state) => state.providerStatus);
  const mcpServers = useWorkspaceStore((state) => state.mcpServers);
  const activeModel = useWorkspaceStore((state) => state.activeModel);

  // Tab UI state from store (persists across mount/unmount)
  const skillsTabUi = useWorkspaceStore((state) => state.skillsTabUi);
  const setSkillsTabSelectedSkillId = useWorkspaceStore(
    (state) => state.setSkillsTabSelectedSkillId
  );
  const setSkillsTabEditingSkill = useWorkspaceStore(
    (state) => state.setSkillsTabEditingSkill
  );
  const setSkillsTabIsGenerating = useWorkspaceStore(
    (state) => state.setSkillsTabIsGenerating
  );
  const setSkillsTabGenerateError = useWorkspaceStore(
    (state) => state.setSkillsTabGenerateError
  );
  const setSkillsTabGenModel = useWorkspaceStore(
    (state) => state.setSkillsTabGenModel
  );
  const setSkillsTabGenDescription = useWorkspaceStore(
    (state) => state.setSkillsTabGenDescription
  );
  const setSkillsTabShowSavedModal = useWorkspaceStore(
    (state) => state.setSkillsTabShowSavedModal
  );

  // Initialize genModel on first mount if it's empty
  useEffect(() => {
    if (!skillsTabUi.genModel) {
      setSkillsTabGenModel(activeModel);
    }
  }, []);

  const selectedSkillId = skillsTabUi.selectedSkillId;
  const editingSkill = skillsTabUi.editingSkill;
  const isGenerating = skillsTabUi.isGenerating;
  const generateError = skillsTabUi.generateError;
  const genModel = skillsTabUi.genModel;
  const genDescription = skillsTabUi.genDescription;
  const showSavedModal = skillsTabUi.showSavedModal;

  // Shortcut functions for store setters with local names
  const setSelectedSkillId = setSkillsTabSelectedSkillId;
  const setEditingSkill = setSkillsTabEditingSkill;
  const setIsGenerating = setSkillsTabIsGenerating;
  const setGenerateError = setSkillsTabGenerateError;
  const setGenModel = setSkillsTabGenModel;
  const setGenDescription = setSkillsTabGenDescription;
  const setShowSavedModal = setSkillsTabShowSavedModal;

  const genRunRef = useRef<RunHandle<"generate_skill"> | null>(null);

  const selectedSkill = skills.find((s) => s.id === selectedSkillId);

  const isDirty = editingSkill && selectedSkill
    ? JSON.stringify(editingSkill) !== JSON.stringify({ ...selectedSkill })
    : editingSkill !== null && !skills.some(s => s.id === editingSkill?.id);

  // Tracks which skill's pristine copy editingSkill was last synced from.
  // Lazily initialized to the store's own persisted selectedSkillId (not
  // undefined/null) so that remounting this component -- which happens on
  // every tab switch, since inactive tabs unmount -- does NOT re-run the
  // sync below and stomp an in-progress, unsaved draft that already
  // survived in skillsTabUi.editingSkill. The sync should only fire when
  // the user actually picks a *different* skill (or a fresh one) while
  // this component is mounted, not merely because a fresh component
  // instance is observing an unchanged selection for the first time.
  const syncedSkillIdRef = useRef<string | null>(selectedSkillId);

  useEffect(() => {
    if (syncedSkillIdRef.current === selectedSkillId) return;
    syncedSkillIdRef.current = selectedSkillId;
    if (selectedSkill) {
      setEditingSkill({ ...selectedSkill });
    } else {
      setEditingSkill(null);
    }
  }, [selectedSkillId, selectedSkill]);

  const handleNewSkill = () => {
    const id = `skill_custom_${Date.now()}`;
    const newSkill: Skill = {
      id,
      name: "New Skill",
      description: "",
      systemPrompt: "",
      enabledTools: ["read_file", "write_file", "list_files", "search_codebase", "web_search", "run_command"],
      mcpServers: [],
      isBuiltIn: false,
      icon: "help",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    addSkill(newSkill);
    setSelectedSkillId(id);
    setEditingSkill({ ...newSkill });
  };

  const handleSave = async () => {
    if (!editingSkill?.id) return;
    const fullSkill: Skill = {
      id: editingSkill.id,
      name: editingSkill.name || "Unnamed Skill",
      description: editingSkill.description || "",
      systemPrompt: editingSkill.systemPrompt || "",
      enabledTools: editingSkill.enabledTools || [],
      preferredModel: editingSkill.preferredModel,
      mcpServers: editingSkill.mcpServers || [],
      isBuiltIn: editingSkill.isBuiltIn || false,
      icon: editingSkill.icon,
      createdAt: editingSkill.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (editingSkill.isBuiltIn) {
      updateSkill(fullSkill.id, fullSkill);
    } else {
      addSkill(fullSkill);
      if (rootPath) {
        await skillsService.saveSkill(rootPath, fullSkill);
      }
    }
    setSelectedSkillId(fullSkill.id);
    setShowSavedModal(true);
    setTimeout(() => setShowSavedModal(false), 2000);
  };

  const handleDelete = async (id: string) => {
    const skill = skills.find((s) => s.id === id);
    if (!skill) return;
    if (skill.isBuiltIn) return;
    deleteSkill(id);
    if (rootPath) {
      await skillsService.deleteSkill(rootPath, id);
    }
    if (selectedSkillId === id) {
      setSelectedSkillId(null);
      setEditingSkill(null);
    }
  };

  const handleToolToggle = (toolId: string) => {
    if (!editingSkill) return;
    const current = editingSkill.enabledTools || [];
    const updated = current.includes(toolId)
      ? current.filter((t) => t !== toolId)
      : [...current, toolId];
    setEditingSkill({ ...editingSkill, enabledTools: updated });
  };

  const handleMcpToggle = (serverName: string) => {
    if (!editingSkill) return;
    const current = editingSkill.mcpServers || [];
    const updated = current.includes(serverName)
      ? current.filter((n) => n !== serverName)
      : [...current, serverName];
    setEditingSkill({ ...editingSkill, mcpServers: updated });
  };

  const handleGenerateWithAI = async (model: string, description: string) => {
    if (!description.trim()) return;
    setIsGenerating(true);
    setGenerateError(null);

    try {
      // Was: customProviders.find(p => providerHasModelReference(p, model)),
      // no fallback at all -- silently sent `null` whenever `model` didn't
      // match anything (the common case before the genModel seeding fix
      // below existed, since genModel defaulted to "" and was never seeded
      // from activeModel). resolveExecutionProvider both fixes the missing
      // fallback and gates on registry status (REFACTOR_PLAN.md PR 3c).
      const resolution = resolveExecutionProvider(customProviders, providerStatus, activeCustomProviderId, model);
      if (!resolution.ok) {
        setGenerateError(resolution.message);
        setIsGenerating(false);
        notify("Cannot generate", resolution.message, "error");
        return;
      }
      const provider = resolution.provider;

      let timedOut = false;
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        genRunRef.current?.cancel();
        genRunRef.current = null;
        setIsGenerating(false);
        notify("Timeout", "Skill generation request timed out after 60 seconds.", "info");
      }, 60000);

      const handle = harness.run(
        "generate_skill",
        {
          model,
          description,
          workspaceRoot: rootPath,
          customProvider: provider,
        },
        createRunHost(),
        () => {},
      );
      genRunRef.current = handle;
      void handle.done.then((outcome) => {
        if (timedOut) return;
        if (outcome.status === "completed") {
          clearTimeout(timeoutHandle);
          const spec = outcome.result.spec;
          try {
            const generated = typeof spec === "string" ? JSON.parse(spec) : spec as any;
            setEditingSkill({
              ...editingSkill!,
              systemPrompt: generated.systemPrompt || "",
              enabledTools: generated.enabledTools ?? [],
              description: generated.description || description,
            });
          } catch {
            setGenerateError("Failed to parse generated skill. Please try again.");
            notify("Parse Error", "Failed to parse generated skill specification.", "error");
          }
          genRunRef.current = null;
          setIsGenerating(false);
        } else if (outcome.status === "failed") {
          clearTimeout(timeoutHandle);
          setGenerateError(outcome.error.message);
          genRunRef.current = null;
          setIsGenerating(false);
          notify("Generation Error", `Skill generation failed with error: ${outcome.error.message}`, "error");
        }
      });
    } catch (err: any) {
      setGenerateError(String(err));
      setIsGenerating(false);
      notify("Exception", `An unexpected exception occurred: ${err.message || String(err)}`, "error");
    }
  };

  const { options: modelOptions, unauthenticatedProviders } = useSelectableModels(
    customProviders,
    providerStatus,
    activeCustomProviderId,
  );

  return {
    modelOptions,
    unauthenticatedProviders,
    skills,
    addSkill,
    updateSkill,
    deleteSkill,
    rootPath,
    customProviders,
    activeCustomProviderId,
    providerStatus,
    mcpServers,
    activeModel,
    skillsTabUi,
    setSkillsTabSelectedSkillId,
    setSkillsTabEditingSkill,
    setSkillsTabIsGenerating,
    setSkillsTabGenerateError,
    setSkillsTabGenModel,
    setSkillsTabGenDescription,
    setSkillsTabShowSavedModal,
    selectedSkillId,
    editingSkill,
    isGenerating,
    generateError,
    genModel,
    genDescription,
    showSavedModal,
    setSelectedSkillId,
    setEditingSkill,
    setIsGenerating,
    setGenerateError,
    setGenModel,
    setGenDescription,
    setShowSavedModal,
    genRunRef,
    selectedSkill,
    isDirty,
    syncedSkillIdRef,
    handleNewSkill,
    handleSave,
    handleDelete,
    handleToolToggle,
    handleMcpToggle,
    handleGenerateWithAI,
  };
}

export type SkillsTabModel = ReturnType<typeof useSkillsTab>;
