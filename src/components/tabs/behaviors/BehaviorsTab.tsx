/**
 * BehaviorsTab — design how agents behave, as rusty-core JSON documents.
 *
 * Two nested canvases:
 * - Workflows: orchestration graphs (input → agent → verify → output). An
 *   agent step names the behavior profile its agent runs under; opening it
 *   drills into the profile canvas.
 * - Profiles: every workspace profile (plus the read-only built-ins) as a
 *   node, with `switch_profile` rules as edges. Connecting two profiles adds
 *   a switch rule; the inspector edits instructions, tools, limits, rules and
 *   the completion gate.
 *
 * Every edit is validated live by rusty-core's own compilers (the
 * `behavior_validate_*` Tauri commands); files are only written on Save.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileJson, Play, Plus, RotateCcw, Save, Trash2, Workflow as WorkflowIcon } from "lucide-react";
import { useWorkspaceStore } from "../../../store";
import { notify } from "../../../notificationStore";
import { ConfirmModal } from "../../ConfirmModal";
import { Button, Callout, Field, IconButton, Input, Modal } from "../../ui";
import { ProfileCanvas, WorkflowCanvas } from "./BehaviorCanvases";
import {
  type Issue,
  type JsonObject,
  type Position,
  type StepType,
  addStep,
  connectProfiles,
  connectSteps,
  isBuiltin,
  newProfile,
  newWorkflow,
  profileId,
  replaceStep,
  stableStringify,
  stepConfig,
  stepsOf,
  withPosition,
  workflowId,
} from "./behaviorModel";
import { behaviorService, profilePath, workflowPath, type LoadFailure } from "./behaviorService";
import { BUILTIN_WORKFLOW_PATH, STARTER_PROFILES } from "./starterFlow";
import { JsonField } from "./InspectorFields";
import { ProfileInspector } from "./ProfileInspector";
import { WorkflowInspector, type WorkflowSelection } from "./WorkflowInspector";
import { useWorkflowRunStore } from "./workflowRunStore";
import styles from "./Behaviors.module.css";
import { useInspectorWidth } from "./useInspectorWidth";

type Mode = "workflows" | "profiles";

interface Doc {
  path: string;
  document: JsonObject;
  /** Serialized form on disk; `null` for a document not written yet. */
  saved: string | null;
}

interface DrillOrigin {
  workflowPath: string;
  stepId: string;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const VALIDATION_DELAY_MS = 250;

const isDirty = (doc: Doc) => doc.saved !== stableStringify(doc.document);

export const BehaviorsTab: React.FC<{ isActive?: boolean }> = ({ isActive = true }) => {
  const inspector = useInspectorWidth();
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const openTab = useWorkspaceStore((state) => state.openTab);
  const runs = useWorkflowRunStore((state) => state.runs);
  const behaviorsRequest = useWorkflowRunStore((state) => state.behaviorsRequest);
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
      // A workspace without workflows opens on the Plan → Build → Verify flow.
      const [loadedProfiles, loadedWorkflows, templates, workspaceDefault] = await Promise.all([
        behaviorService.loadProfiles(rootPath),
        behaviorService.loadWorkflows(rootPath),
        behaviorService.templates().catch(() => undefined),
        behaviorService.loadDefaultProfile(rootPath),
      ]);
      setProfiles(loadedProfiles.documents.map(({ path, document, saved }) => ({ path, document, saved })));
      setWorkflows(loadedWorkflows.documents.map(({ path, document, saved }) => ({ path, document, saved })));
      setFailures([...loadedProfiles.failures, ...loadedWorkflows.failures]);
      setBuiltins([...(templates?.builtin_profiles ?? []), ...STARTER_PROFILES]);
      setWorkflowTemplate(templates?.default_workflow);
      setDefaultProfile(workspaceDefault);
      setSelectedWorkflow((current) => current ?? loadedWorkflows.documents[0]?.path);
      if (loadedWorkflows.documents.length === 0 && loadedProfiles.documents.length > 0) setMode("profiles");
    } finally {
      setLoading(false);
    }
  }, [rootPath]);

  useEffect(() => {
    void load();
  }, [load]);

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
      const library = [...profiles.map((doc) => doc.document), ...STARTER_PROFILES];
      const next: Record<string, Issue[]> = {};
      try {
        await Promise.all([
          ...profiles.map(async (doc) => {
            next[profileId(doc.document)] = await behaviorService.validateProfile(
              doc.document,
              library.filter((other) => other !== doc.document),
            );
          }),
          ...workflows.map(async (doc) => {
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
  }, [profiles, workflows]);

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
    if (path === BUILTIN_WORKFLOW_PATH) return;
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
      if (workflowDocPath === BUILTIN_WORKFLOW_PATH && !profile) return;
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

  if (!rootPath) {
    return (
      <div className={styles.root}>
        <div className={styles.canvasEmpty}>Open a workspace to design its behaviors.</div>
      </div>
    );
  }

  const currentDoc = mode === "profiles" ? currentProfileDoc : currentWorkflow;
  const currentIssues =
    mode === "profiles" ? (selectedProfile ? issues[selectedProfile] ?? [] : []) : currentWorkflow ? issues[currentWorkflow.path] ?? [] : [];

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div className={styles.modes} role="tablist" aria-label="Canvas">
          {(["workflows", "profiles"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              className={`${styles.mode} ${mode === value ? styles.modeActive : ""}`}
              onClick={() => (value === "workflows" ? returnToWorkflow() : setMode("profiles"))}
            >
              {value === "workflows" ? "Workflows" : "Profiles"}
            </button>
          ))}
        </div>
        <nav className={styles.crumbs} aria-label="Location">
          {mode === "workflows" ? (
            <span className={styles.crumbCurrent}>{currentWorkflow ? String(currentWorkflow.document.name ?? workflowId(currentWorkflow.document)) : "No workflow selected"}</span>
          ) : (
            <>
              {drillWorkflow && drillStep ? (
                <>
                  <button type="button" className={styles.crumb} onClick={returnToWorkflow}>
                    {String(drillWorkflow.document.name ?? workflowId(drillWorkflow.document))}
                  </button>
                  <span>›</span>
                  <button type="button" className={styles.crumb} onClick={returnToWorkflow}>
                    {String(drillStep.name ?? drillStep.id)}
                  </button>
                  <span>›</span>
                </>
              ) : null}
              <span className={styles.crumbCurrent}>{currentProfile ? String(currentProfile.name ?? selectedProfile) : "All profiles"}</span>
            </>
          )}
        </nav>
        <div className={styles.actions}>
          {mode === "workflows" && currentWorkflow ? (
            <Button
              type="button"
              icon={<Play size={14} />}
              onClick={() => void runInAgentMode()}
              title="Run this workflow from Agent Mode, with that chat's model and tools"
            >
              Run in Agent Mode
            </Button>
          ) : null}
          <Button type="button" icon={<Plus size={14} />} onClick={() => setCreating(mode)}>
            {mode === "profiles" ? "New profile" : "New workflow"}
          </Button>
          <Button
            type="button"
            variant="primary"
            icon={<Save size={14} />}
            loading={saving}
            disabled={dirtyCount === 0}
            onClick={() => void saveAll()}
          >
            {dirtyCount ? `Save ${dirtyCount}` : "Saved"}
          </Button>
        </div>
      </div>

      <div className={styles.body} ref={inspector.bodyRef} style={{ "--inspector-width": `${inspector.width}px` } as React.CSSProperties}>
        <aside className={styles.list}>
          {mode === "workflows" ? (
            <>
              <div className={styles.listHeader}>Workflows</div>
              {workflows.map((doc) => (
                <button
                  key={doc.path}
                  type="button"
                  className={`${styles.listItem} ${doc.path === selectedWorkflow ? styles.listItemActive : ""}`}
                  onClick={() => {
                    setSelectedWorkflow(doc.path);
                    setWorkflowSelection({ kind: "workflow" });
                    setShowJson(false);
                  }}
                >
                  <WorkflowIcon size={14} />
                  <span className={styles.listName}>{String(doc.document.name ?? workflowId(doc.document))}</span>
                  {doc.path === BUILTIN_WORKFLOW_PATH ? <span className={styles.badge}>Built-in</span> : <StatusDot dirty={isDirty(doc)} issues={issues[doc.path]} />}
                </button>
              ))}
              {workflows.length === 0 && !loading ? (
                <p className={styles.listEmpty}>
                  No workflows yet. A workflow chains agent steps with verification; start from the default one.
                </p>
              ) : null}
            </>
          ) : (
            <>
              <div className={styles.listHeader}>Workspace profiles</div>
              {profiles.map((doc) => {
                const id = profileId(doc.document);
                return (
                  <button
                    key={doc.path}
                    type="button"
                    className={`${styles.listItem} ${id === selectedProfile ? styles.listItemActive : ""}`}
                    onClick={() => selectProfile(id)}
                  >
                    <FileJson size={14} />
                    <span className={styles.listName}>{id}</span>
                    {id === defaultProfile ? <span className={styles.chip}>default</span> : null}
                    <StatusDot dirty={isDirty(doc)} issues={issues[id]} />
                  </button>
                );
              })}
              {profiles.length === 0 && !loading ? (
                <p className={styles.listEmpty}>
                  No profiles yet. A profile adds instructions, tool limits, rules and a completion gate to every agent
                  that runs under it.
                </p>
              ) : null}
              <div className={styles.listHeader}>Built-in</div>
              {builtins.map((profile) => {
                const id = profileId(profile);
                return (
                  <button
                    key={id}
                    type="button"
                    className={`${styles.listItem} ${id === selectedProfile ? styles.listItemActive : ""}`}
                    onClick={() => selectProfile(id)}
                  >
                    <FileJson size={14} />
                    <span className={styles.listName}>{id}</span>
                    {!defaultProfile ? <span className={styles.chip}>default</span> : null}
                  </button>
                );
              })}
            </>
          )}
          {failures.length ? (
            <div className={styles.listEmpty}>
              <Callout variant="warning">
                {failures.length} file{failures.length === 1 ? "" : "s"} could not be read:{" "}
                {failures.map((failure) => failure.path.split("/").pop()).join(", ")}
              </Callout>
            </div>
          ) : null}
        </aside>

        <main className={styles.canvas}>
          {mode === "profiles" ? (
            profiles.length + builtins.length === 0 ? (
              <div className={styles.canvasEmpty}>{loading ? "Loading…" : "Create a profile to start."}</div>
            ) : (
              <>
                <ProfileCanvas
                  profiles={profiles.map((doc) => doc.document)}
                  builtins={builtins}
                  builtinPositions={builtinPositions}
                  selected={selectedProfile}
                  defaultProfile={defaultProfile}
                  dirty={dirtyProfiles}
                  issues={issues}
                  onSelect={selectProfile}
                  onMove={(id, position) => {
                    if (isBuiltin(id)) setBuiltinPositions((current) => ({ ...current, [id]: position }));
                    else updateProfile(id, (profile) => withPosition(profile, position));
                  }}
                  onConnect={(source, target) => {
                    if (isBuiltin(source)) {
                      notify("Built-in profiles are read-only", "Connect from a workspace profile instead.", "info");
                      return;
                    }
                    const doc = profiles.find((candidate) => profileId(candidate.document) === source);
                    if (!doc) return;
                    const connected = connectProfiles(doc.document, target);
                    updateProfile(source, () => connected.profile);
                    selectProfile(source, connected.ruleIndex);
                  }}
                />
                <div className={styles.canvasHint}>
                  Drag from a profile's right handle to another profile to add a switch rule. Click an edge to edit
                  the rule behind it.
                </div>
              </>
            )
          ) : currentWorkflow ? (
            <>
            <RunBanner run={runs[workflowId(currentWorkflow.document)]} />
            <WorkflowCanvas
              key={currentWorkflow.path}
              readOnly={currentWorkflow.path === BUILTIN_WORKFLOW_PATH}
              workflow={currentWorkflow.document}
              selectedStep={workflowSelection.kind === "step" ? workflowSelection.id : undefined}
              selectedEdge={workflowSelection.kind === "edge" ? workflowSelection.id : undefined}
              issues={issues[currentWorkflow.path] ?? []}
              runSteps={runs[workflowId(currentWorkflow.document)]?.steps}
              onSelectStep={(id) => {
                setWorkflowSelection({ kind: "step", id });
                setShowJson(false);
              }}
              onSelectEdge={(id) => setWorkflowSelection({ kind: "edge", id })}
              onSelectNone={() => setWorkflowSelection({ kind: "workflow" })}
              onMove={(id, position) =>
                updateWorkflow(currentWorkflow.path, (document) => {
                  const step = stepsOf(document).find((candidate) => candidate.id === id);
                  return step ? replaceStep(document, id, withPosition(step, position)) : document;
                })
              }
              onConnect={(source, target) => updateWorkflow(currentWorkflow.path, (document) => connectSteps(document, source, target))}
              onAddStep={(type: StepType, position) => {
                const result = addStep(currentWorkflow.document, type, position);
                updateWorkflow(currentWorkflow.path, () => result.workflow);
                setWorkflowSelection({ kind: "step", id: result.id });
              }}
              onDrill={(stepId, profile) => drill(currentWorkflow.path, stepId, profile)}
            />
            </>
          ) : (
            <div className={styles.canvasEmpty}>
              <div>
                <p>{loading ? "Loading…" : "Select a workflow, or create one from the default single-agent workflow."}</p>
                {!loading ? (
                  <Button type="button" variant="primary" icon={<Plus size={14} />} onClick={() => setCreating("workflows")}>
                    New workflow
                  </Button>
                ) : null}
              </div>
            </div>
          )}
        </main>

        {inspector.handle}
        <aside className={styles.inspector} aria-label="Inspector">
          {mode === "profiles" && currentProfile ? (
            <>
              <InspectorHeader
                title={String(currentProfile.name ?? selectedProfile)}
                showJson={showJson}
                onToggleJson={() => setShowJson((value) => !value)}
                canEdit={Boolean(currentProfileDoc)}
                dirty={currentProfileDoc ? isDirty(currentProfileDoc) : false}
                onRevert={revertCurrent}
                onDelete={() => setConfirmDelete(true)}
              />
              {showJson ? (
                <div className={styles.section}>
                  <JsonField
                    id={`profile-json-${selectedProfile}`}
                    label={currentProfileDoc ? currentProfileDoc.path.replace(`${rootPath}/`, "") : "Built-in profile"}
                    value={currentProfile}
                    tall
                    readOnly={!currentProfileDoc}
                    onChange={(value) => {
                      if (value && typeof value === "object" && !Array.isArray(value) && selectedProfile) {
                        const nextId = profileId(value);
                        updateProfile(selectedProfile, () => value);
                        if (nextId && nextId !== selectedProfile) setSelectedProfile(nextId);
                      }
                    }}
                  />
                </div>
              ) : (
                <ProfileInspector
                  profile={currentProfile}
                  readOnly={!currentProfileDoc}
                  issues={currentIssues}
                  profileIds={profileIds}
                  focusedRule={focusedRule}
                  isDefault={defaultProfile ? defaultProfile === selectedProfile : !currentProfileDoc}
                  onChange={(next) => selectedProfile && updateProfile(selectedProfile, () => next)}
                  onSetDefault={(on) => void setWorkspaceDefault(on ? selectedProfile : undefined)}
                />
              )}
            </>
          ) : mode === "workflows" && currentWorkflow ? (
            <>
              <InspectorHeader
                title={
                  workflowSelection.kind === "step"
                    ? `Step · ${workflowSelection.id}`
                    : workflowSelection.kind === "edge"
                      ? "Edge"
                      : String(currentWorkflow.document.name ?? workflowId(currentWorkflow.document))
                }
                showJson={showJson}
                onToggleJson={() => setShowJson((value) => !value)}
                canEdit={currentWorkflow.path !== BUILTIN_WORKFLOW_PATH}
                dirty={isDirty(currentWorkflow)}
                onRevert={revertCurrent}
                onDelete={() => setConfirmDelete(true)}
              />
              {currentWorkflow.path === BUILTIN_WORKFLOW_PATH ? (
                <div className={styles.section}><Button onClick={() => setCreating("workflows")}>Customize a copy</Button></div>
              ) : null}
              <fieldset disabled={currentWorkflow.path === BUILTIN_WORKFLOW_PATH} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              {currentWorkflow.path === BUILTIN_WORKFLOW_PATH ? <p className={styles.muted}>Built into Rusty · available in every project.</p> : null}
              {showJson ? (
                <div className={styles.section}>
                  <JsonField
                    id={`workflow-json-${currentWorkflow.path}`}
                    label={currentWorkflow.path.replace(`${rootPath}/`, "")}
                    value={currentWorkflow.document}
                    tall
                    onChange={(value) => {
                      if (value && typeof value === "object" && !Array.isArray(value)) {
                        updateWorkflow(currentWorkflow.path, () => value);
                      }
                    }}
                  />
                </div>
              ) : (
                <WorkflowInspector
                  workflow={currentWorkflow.document}
                  selection={workflowSelection}
                  issues={currentIssues}
                  profileIds={profileIds}
                  onChange={(next) => updateWorkflow(currentWorkflow.path, () => next)}
                  onSelect={setWorkflowSelection}
                  onDrill={(profile) => {
                    if (workflowSelection.kind === "step") drill(currentWorkflow.path, workflowSelection.id, profile);
                  }}
                />
              )}
              </fieldset>
            </>
          ) : (
            <div className={styles.section}>
              <p className={styles.muted}>
                {mode === "profiles"
                  ? "Select a profile to edit it. Profiles are saved to .rusty/profiles/ and apply to new agent sessions in this workspace."
                  : "Select a workflow on the left."}
              </p>
            </div>
          )}
        </aside>
      </div>

      {creating ? (
        <CreateModal
          kind={creating}
          taken={creating === "profiles" ? profileIds : workflows.map((doc) => workflowId(doc.document))}
          onCancel={() => setCreating(undefined)}
          onCreate={(id) => {
            setCreating(undefined);
            if (creating === "profiles") {
              createProfile(id);
              setMode("profiles");
              selectProfile(id);
            } else if (rootPath) {
              const path = workflowPath(rootPath, id);
              setWorkflows((current) => [...current, { path, document: currentWorkflow?.path === BUILTIN_WORKFLOW_PATH
                ? { ...JSON.parse(JSON.stringify(currentWorkflow.document)), id, name: id, revision: 1 }
                : newWorkflow(id, workflowTemplate), saved: null }]);
              setSelectedWorkflow(path);
              setWorkflowSelection({ kind: "workflow" });
              setMode("workflows");
            }
          }}
        />
      ) : null}

      <ConfirmModal
        open={confirmDelete}
        title={mode === "profiles" ? "Delete profile?" : "Delete workflow?"}
        message={
          currentDoc
            ? `${currentDoc.path.replace(`${rootPath}/`, "")} will be deleted from disk. Rules in other profiles that switch to it will stop validating.`
            : ""
        }
        confirmLabel="Delete"
        kind="danger"
        onConfirm={() => void deleteCurrent()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
};

const RunBanner: React.FC<{ run?: ReturnType<typeof useWorkflowRunStore.getState>["runs"][string] }> = ({ run }) => {
  if (!run) return null;
  const label = { running: "Running in Agent Mode…", completed: "Last run completed", failed: "Last run failed", cancelled: "Last run cancelled" }[run.status];
  const badge = { running: styles.badgeRunning, completed: styles.badgeSuccess, failed: styles.badgeDanger, cancelled: styles.badgeWarning }[run.status];
  return (
    <div className={styles.runBanner} role="status">
      <span className={`${styles.badge} ${badge}`}>{run.status}</span>
      <span>{label}</span>
      {run.error ? <span className={styles.runError} title={run.error}>{run.error}</span> : null}
    </div>
  );
};

const StatusDot: React.FC<{ dirty: boolean; issues?: Issue[] }> = ({ dirty, issues }) => {
  const invalid = (issues ?? []).some((issue) => issue.blocking);
  if (invalid) return <span className={`${styles.dot} ${styles.dotError}`} title="Has validation issues" />;
  if (dirty) return <span className={styles.dot} title="Unsaved changes" />;
  return null;
};

const InspectorHeader: React.FC<{
  title: string;
  showJson: boolean;
  onToggleJson: () => void;
  canEdit: boolean;
  dirty: boolean;
  onRevert: () => void;
  onDelete: () => void;
}> = ({ title, showJson, onToggleJson, canEdit, dirty, onRevert, onDelete }) => (
  <div className={styles.inspectorHeader}>
    <span className={styles.inspectorTitle}>{title}</span>
    <IconButton icon={<FileJson size={14} />} label={showJson ? "Show form" : "Edit as JSON"} size="sm" selected={showJson} onClick={onToggleJson} />
    {canEdit ? (
      <>
        <IconButton icon={<RotateCcw size={14} />} label="Revert unsaved changes" size="sm" disabled={!dirty} onClick={onRevert} />
        <IconButton icon={<Trash2 size={14} />} label="Delete file" size="sm" onClick={onDelete} />
      </>
    ) : null}
  </div>
);

const CreateModal: React.FC<{
  kind: Mode;
  taken: string[];
  onCancel: () => void;
  onCreate: (id: string) => void;
}> = ({ kind, taken, onCancel, onCreate }) => {
  const [id, setId] = useState("");
  const error = !id
    ? undefined
    : !ID_PATTERN.test(id)
      ? "Use lowercase letters, digits, dots, dashes or underscores."
      : id.startsWith("rusty.")
        ? "Ids starting with rusty. are reserved for built-ins."
        : taken.includes(id)
          ? "That id is already used."
          : undefined;
  const submit = () => {
    if (id && !error) onCreate(id);
  };
  return (
    <Modal
      id="behaviors-create"
      title={kind === "profiles" ? "New behavior profile" : "New workflow"}
      description={
        kind === "profiles"
          ? "Saved as .rusty/profiles/<id>.json. Starts as a draft with no rules."
          : "Your editable workflow will be saved as .rusty/workflows/<id>.json."
      }
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="primary" disabled={!id || Boolean(error)} onClick={submit}>
            Create
          </Button>
        </>
      }
    >
      <Field id="behaviors-create-id" label="Id" error={error}>
        <Input
          id="behaviors-create-id"
          autoFocus
          value={id}
          placeholder={kind === "profiles" ? "careful-editor" : "plan-build-verify"}
          onChange={(event) => setId(event.target.value.trim())}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
      </Field>
    </Modal>
  );
};
