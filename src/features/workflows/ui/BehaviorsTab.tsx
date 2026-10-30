import React from "react";
import { Play, Plus, Save } from "lucide-react";
import { notify } from "../../notifications";
import { ConfirmModal } from "../../../lib/ui/ConfirmModal";
import { Button } from "../../../lib/ui";
import { ProfileCanvas } from "./ProfileCanvas";
import { WorkflowCanvas } from "./WorkflowCanvas";
import { type StepType, addStep, connectProfiles, connectSteps, isBuiltin, newWorkflow, profileId, replaceStep, stepsOf, withPosition, workflowId } from "../model";
import { workflowPath } from "../service/behaviorService";
import { isBuiltinWorkflowPath } from "../model/starterFlow";
import styles from "./Behaviors.module.css";
import { RunBanner } from "./RunBanner";
import { CreateModal } from "./CreateModal";
import { useBehaviorsTab } from "./useBehaviorsTab";
import { BehaviorList } from "./BehaviorList";
import { BehaviorInspectorPane } from "./BehaviorInspectorPane";
export const BehaviorsTab: React.FC<{ isActive?: boolean }> = (props) => {
  const model = useBehaviorsTab(props);
  const { inspector, rootPath, runs, mode, setMode, profiles, workflows, setWorkflows, builtins, builtinPositions, setBuiltinPositions, workflowTemplate, defaultProfile,  loading, issues, selectedProfile,    setSelectedWorkflow, workflowSelection, setWorkflowSelection,  setShowJson, creating, setCreating, confirmDelete, setConfirmDelete, saving, profileIds, dirtyProfiles, dirtyCount, currentWorkflow,  currentProfile, drillWorkflow, drillStep, updateProfile, updateWorkflow, selectProfile, createProfile, drill, returnToWorkflow, saveAll, runInAgentMode,  deleteCurrent,  currentDoc,  } = model;
  if (!rootPath) {
    return (
      <div className={styles.root}>
        <div className={styles.canvasEmpty}>Open a workspace to design its behaviors.</div>
      </div>
    );
  }
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
        <BehaviorList model={model} />

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
              readOnly={isBuiltinWorkflowPath(currentWorkflow.path)}
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
        <BehaviorInspectorPane model={model} />
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
              setWorkflows((current) => [...current, { path, document: currentWorkflow && isBuiltinWorkflowPath(currentWorkflow.path)
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
