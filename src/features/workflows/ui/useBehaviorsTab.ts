import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceStore } from "../../../store";
import { notify } from "../../notifications";
import { type Issue, type JsonObject, type Position, newProfile, profileId, replaceStep, stepConfig, stepsOf, withPosition, workflowId } from "../model";
import { behaviorService, profilePath, type LoadFailure } from "../service/behaviorService";
import { isBuiltinWorkflowPath } from "../model/starterFlow";
import { isBuiltinEntry, workflowCatalogService } from "../service/workflowCatalogService";
import { type WorkflowSelection } from "./WorkflowInspector";
import { useWorkflowRunStore } from "../state";
import { useInspectorWidth } from "./useInspectorWidth";
import { Mode, Doc, DrillOrigin, VALIDATION_DELAY_MS, isDirty, stored, mergeExternalDocuments } from "./documents";

export function useBehaviorsTab(props: { isActive?: boolean }) {
  const { isActive } = props;
  const inspector = useInspectorWidth();
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const openTab = useWorkspaceStore((state) => state.openTab);
  const runs = useWorkflowRunStore((state) => state.runs);
  const behaviorsRequest = useWorkflowRunStore((state) => state.behaviorsRequest);
  const catalogVersion = useWorkflowRunStore((state) => state.catalogVersion);
  const [mode, setMode] = useState<Mode>("workflows");
  const [profiles, setProfiles] = useState<Doc[]>([]);
  const [workflows, setWorkflows] = useState<Doc[]>([]);
  const [builtins, setBuiltins] = useState<JsonObject[]>([]);
  const [builtinPositions, setBuiltinPositions] = useState<Record<string, Position>>({});
  const [workflowTemplate, setWorkflowTemplate] = useState<JsonObject>();
  const [defaultProfile, setDefaultProfile] = useState<string>();
  const [failures, setFailures] = useState<LoadFailure[]>([]);
  const [loading, setLoading] = useState(false);
  const [issues, setIssues] = useState<Record<string, Issue[]>>({});

  const [selectedProfile, setSelectedProfile] = useState<string>();
  const [focusedRule, setFocusedRule] = useState<number>();
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>();
  const [workflowSelection, setWorkflowSelection] = useState<WorkflowSelection>({ kind: "workflow" });
  const [drillOrigin, setDrillOrigin] = useState<DrillOrigin>();
  const [showJson, setShowJson] = useState(false);
  const [creating, setCreating] = useState<Mode>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  /* ---------------- Loading ---------------- */

  const load = useCallback(async () => {
    if (!rootPath) return;
    setLoading(true);
    try {
      // The workflow list opens on Plan → Build → Verify, the first built-in.
      const [catalog, workspaceDefault] = await Promise.all([
        workflowCatalogService.load(rootPath),
        behaviorService.loadDefaultProfile(rootPath),
      ]);
      const workspaceProfiles = catalog.profiles.filter((entry) => !isBuiltinEntry(entry));
      setProfiles(workspaceProfiles.map(stored));
      setWorkflows(catalog.workflows.map(stored));
      setFailures(catalog.failures);
      setBuiltins(catalog.profiles.filter(isBuiltinEntry).map((entry) => entry.document));
      setWorkflowTemplate(catalog.default_workflow);
      setDefaultProfile(workspaceDefault);
      setSelectedWorkflow((current) => current ?? catalog.workflows[0]?.path);
    } catch (error) {
      setFailures([{ path: `${rootPath}/.rusty`, error: `Could not list workflows and profiles: ${String(error)}` }]);
    } finally {
      setLoading(false);
    }
  }, [rootPath]);

  useEffect(() => {
    void load();
  }, [load]);

  // External validated authoring saves bump the catalog without replacing
  // unsaved canvas documents. New files are added and clean documents are
  // refreshed; dirty documents remain authoritative in this editor.
  const previousCatalogVersion = useRef(catalogVersion);
  useEffect(() => {
    if (previousCatalogVersion.current === catalogVersion) return;
    previousCatalogVersion.current = catalogVersion;
    if (!rootPath) return;
    void workflowCatalogService.load(rootPath)
      .then((catalog) => {
        setProfiles((current) => mergeExternalDocuments(current, catalog.profiles.filter((entry) => !isBuiltinEntry(entry)).map(stored)));
        setWorkflows((current) => mergeExternalDocuments(current, catalog.workflows.map(stored)));
      })
      .catch(() => undefined);
  }, [catalogVersion, rootPath]);

  // "Edit workflow" from an Agent chat: show that workflow once loaded.
  useEffect(() => {
    if (!behaviorsRequest || loading) return;
    const path = useWorkflowRunStore.getState().takeBehaviorsRequest();
    if (!path) return;
    if (workflows.some((doc) => doc.path === path)) {
      setMode("workflows");
      setSelectedWorkflow(path);
      setWorkflowSelection({ kind: "workflow" });
      setDrillOrigin(undefined);
      setShowJson(false);
    } else {
      notify("Workflow not found", `${path.split("/").pop()} is not in .rusty/workflows.`, "error");
    }
  }, [behaviorsRequest, loading, workflows]);

  /* ---------------- Validation ---------------- */

  const validationRun = useRef(0);
  useEffect(() => {
    const run = ++validationRun.current;
    const timer = window.setTimeout(async () => {
      const library = [...profiles.map((doc) => doc.document), ...builtins];
      const next: Record<string, Issue[]> = {};
      try {
        await Promise.all([
          ...profiles.map(async (doc) => {
            next[profileId(doc.document)] = await behaviorService.validateProfile(
              doc.document,
              library.filter((other) => other !== doc.document),
            );
          }),
          // Built-in workflows ship validated (native tests compile every one); only workspace files can be wrong.
          ...workflows.filter((doc) => !isBuiltinWorkflowPath(doc.path)).map(async (doc) => {
            next[doc.path] = await behaviorService.validateWorkflow(doc.document, library);
          }),
        ]);
      } catch (error) {
        // Validation needs the native core harness; without it the canvas
        // still edits and saves.
        console.warn("Behavior validation unavailable:", error);
      }
      if (run === validationRun.current) setIssues(next);
    }, VALIDATION_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [profiles, workflows, builtins]);

  /* ---------------- Derived ---------------- */

  const profileIds = useMemo(
    () => [...profiles.map((doc) => profileId(doc.document)), ...builtins.map(profileId)],
    [profiles, builtins],
  );
  const dirtyProfiles = useMemo(
    () => new Set(profiles.filter(isDirty).map((doc) => profileId(doc.document))),
    [profiles],
  );
  const dirtyCount = profiles.filter(isDirty).length + workflows.filter(isDirty).length;
  const currentWorkflow = workflows.find((doc) => doc.path === selectedWorkflow);
  const currentProfileDoc = profiles.find((doc) => profileId(doc.document) === selectedProfile);
  const currentBuiltin = builtins.find((profile) => profileId(profile) === selectedProfile);
  const currentProfile = currentProfileDoc?.document ?? currentBuiltin;
  const drillWorkflow = drillOrigin ? workflows.find((doc) => doc.path === drillOrigin.workflowPath) : undefined;
  const drillStep = drillWorkflow ? stepsOf(drillWorkflow.document).find((step) => step.id === drillOrigin?.stepId) : undefined;

  /* ---------------- Mutations ---------------- */

  const updateProfile = useCallback((id: string, update: (profile: JsonObject) => JsonObject) => {
    setProfiles((current) =>
      current.map((doc) => (profileId(doc.document) === id ? { ...doc, document: update(doc.document) } : doc)),
    );
  }, []);

  const updateWorkflow = useCallback((path: string, update: (workflow: JsonObject) => JsonObject) => {
    if (isBuiltinWorkflowPath(path)) return;
    setWorkflows((current) => current.map((doc) => (doc.path === path ? { ...doc, document: update(doc.document) } : doc)));
  }, []);

  const selectProfile = useCallback((id: string | undefined, ruleIndex?: number) => {
    setSelectedProfile(id);
    setFocusedRule(ruleIndex);
    setShowJson(false);
  }, []);

  const createProfile = useCallback(
    (id: string, name = id): string | undefined => {
      if (!rootPath) return undefined;
      const position = { x: 60 + (profiles.length % 3) * 340, y: 60 + Math.floor(profiles.length / 3) * 240 };
      const document = withPosition(newProfile(id, name), position);
      setProfiles((current) => [...current, { path: profilePath(rootPath, id), document, saved: null }]);
      return id;
    },
    [rootPath, profiles.length],
  );

  const drill = useCallback(
    (workflowDocPath: string, stepId: string, profile: string | undefined) => {
      if (isBuiltinWorkflowPath(workflowDocPath) && !profile) return;
      let target = profile;
      if (!target) {
        // A step without a profile gets a fresh one named after it.
        const workflow = workflows.find((doc) => doc.path === workflowDocPath);
        const step = workflow ? stepsOf(workflow.document).find((candidate) => candidate.id === stepId) : undefined;
        let candidate = `${workflowId(workflow?.document ?? {})}-${stepId}`.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
        while (profileIds.includes(candidate)) candidate = `${candidate}-2`;
        target = createProfile(candidate, `${String(step?.name ?? stepId)} behavior`);
        if (!target || !step) return;
        const assigned = target;
        updateWorkflow(workflowDocPath, (document) =>
          replaceStep(document, stepId, { ...step, config: { ...stepConfig(step), profile: { id: assigned } } }),
        );
      }
      setDrillOrigin({ workflowPath: workflowDocPath, stepId });
      selectProfile(target);
      setMode("profiles");
    },
    [workflows, profileIds, createProfile, updateWorkflow, selectProfile],
  );

  const returnToWorkflow = () => {
    if (drillOrigin) {
      setSelectedWorkflow(drillOrigin.workflowPath);
      setWorkflowSelection({ kind: "step", id: drillOrigin.stepId });
    }
    setDrillOrigin(undefined);
    setShowJson(false);
    setMode("workflows");
  };

  const saveAll = useCallback(async () => {
    if (!rootPath) return;
    setSaving(true);
    try {
      const writeDocs = async (docs: Doc[]) =>
        Promise.all(
          docs.map(async (doc) => (isDirty(doc) ? { ...doc, saved: await behaviorService.save(doc.path, doc.document) } : doc)),
        );
      const [savedProfiles, savedWorkflows] = await Promise.all([writeDocs(profiles), writeDocs(workflows)]);
      setProfiles(savedProfiles);
      setWorkflows(savedWorkflows);
      useWorkflowRunStore.getState().catalogChanged();
      const blocking = Object.values(issues).flat().filter((issue) => issue.blocking).length;
      notify(
        "Behaviors saved",
        blocking
          ? `Saved with ${blocking} validation issue${blocking === 1 ? "" : "s"}; invalid profiles are skipped when sessions load.`
          : "New agent sessions in this workspace pick the changes up.",
        blocking ? "info" : "success",
      );
    } catch (error) {
      notify("Could not save", String(error), "error");
    } finally {
      setSaving(false);
    }
  }, [rootPath, profiles, workflows, issues]);

  useEffect(() => {
    if (!isActive) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveAll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive, saveAll]);

  /** Saves the workflow if needed, selects it in Agent Mode, and opens it:
   * the next message there runs the workflow with that chat's model. */
  const runInAgentMode = async () => {
    if (!currentWorkflow) return;
    const blocking = (issues[currentWorkflow.path] ?? []).filter((issue) => issue.blocking);
    if (blocking.length) {
      notify("Workflow has problems", blocking[0].message, "error");
      return;
    }
    try {
      if (isDirty(currentWorkflow)) {
        const saved = await behaviorService.save(currentWorkflow.path, currentWorkflow.document);
        setWorkflows((current) => current.map((doc) => (doc.path === currentWorkflow.path ? { ...doc, saved } : doc)));
      }
    } catch (error) {
      notify("Could not save", String(error), "error");
      return;
    }
    const store = useWorkflowRunStore.getState();
    store.catalogChanged();
    store.requestAgentWorkflow(currentWorkflow.path);
    openTab({ type: "agent" });
    notify(
      "Workflow selected",
      `The Agent chat now follows ${String(currentWorkflow.document.name ?? workflowId(currentWorkflow.document))}; send your request there.`,
      "info",
    );
  };

  const setWorkspaceDefault = async (id: string | undefined) => {
    if (!rootPath) return;
    try {
      await behaviorService.saveDefaultProfile(rootPath, id);
      setDefaultProfile(id);
      notify("Workspace default", id ? `New sessions run under ${id}.` : "New sessions run under the built-in default.", "success");
    } catch (error) {
      notify("Could not update the default", String(error), "error");
    }
  };

  const deleteCurrent = async () => {
    setConfirmDelete(false);
    const doc = mode === "profiles" ? currentProfileDoc : currentWorkflow;
    if (!doc) return;
    try {
      if (doc.saved !== null) await behaviorService.remove(doc.path);
      if (mode === "profiles") {
        const id = profileId(doc.document);
        setProfiles((current) => current.filter((other) => other !== doc));
        selectProfile(undefined);
        if (defaultProfile === id) await setWorkspaceDefault(undefined);
      } else {
        setWorkflows((current) => current.filter((other) => other !== doc));
        setSelectedWorkflow(undefined);
        setWorkflowSelection({ kind: "workflow" });
      }
    } catch (error) {
      notify("Could not delete", String(error), "error");
    }
  };

  const revertCurrent = () => {
    const doc = mode === "profiles" ? currentProfileDoc : currentWorkflow;
    if (!doc) return;
    if (doc.saved === null) {
      void deleteCurrent();
      return;
    }
    const document = JSON.parse(doc.saved) as JsonObject;
    if (mode === "profiles") setProfiles((current) => current.map((other) => (other === doc ? { ...doc, document } : other)));
    else setWorkflows((current) => current.map((other) => (other === doc ? { ...doc, document } : other)));
  };

  /* ---------------- Render ---------------- */

  const currentDoc = mode === "profiles" ? currentProfileDoc : currentWorkflow;
  const currentIssues =
    mode === "profiles" ? (selectedProfile ? issues[selectedProfile] ?? [] : []) : currentWorkflow ? issues[currentWorkflow.path] ?? [] : [];



  return {
    currentDoc, currentIssues, inspector, rootPath,
    openTab, runs, behaviorsRequest, catalogVersion,
    mode, setMode, profiles, setProfiles,
    workflows, setWorkflows, builtins, setBuiltins,
    builtinPositions, setBuiltinPositions, workflowTemplate, setWorkflowTemplate,
    defaultProfile, setDefaultProfile, failures, setFailures,
    loading, setLoading, issues, setIssues,
    selectedProfile, setSelectedProfile, focusedRule, setFocusedRule,
    selectedWorkflow, setSelectedWorkflow, workflowSelection, setWorkflowSelection,
    drillOrigin, setDrillOrigin, showJson, setShowJson,
    creating, setCreating, confirmDelete, setConfirmDelete,
    saving, setSaving, load, previousCatalogVersion,
    validationRun, profileIds, dirtyProfiles, dirtyCount,
    currentWorkflow, currentProfileDoc, currentBuiltin, currentProfile,
    drillWorkflow, drillStep, updateProfile, updateWorkflow,
    selectProfile, createProfile, drill, returnToWorkflow,
    saveAll, runInAgentMode, setWorkspaceDefault, deleteCurrent,
    revertCurrent,
  };
}

export type BehaviorsTabModel = ReturnType<typeof useBehaviorsTab>;
