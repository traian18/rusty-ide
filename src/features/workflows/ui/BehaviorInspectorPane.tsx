import React from "react";
import { Button } from "../../../lib/ui";
import { profileId, workflowId } from "../model";
import { isBuiltinWorkflowPath } from "../model/starterFlow";
import { JsonField } from "./InspectorFields";
import { ProfileInspector } from "./ProfileInspector";
import { WorkflowInspector } from "./WorkflowInspector";
import styles from "./Behaviors.module.css";
import { InspectorHeader } from "./InspectorHeader";
import { isDirty } from "./documents";
import type { BehaviorsTabModel } from "./useBehaviorsTab";

// The names it reads from the tab model are destructured below.
export const BehaviorInspectorPane: React.FC<{ model: BehaviorsTabModel }> = ({ model }) => {
  const { currentIssues,  rootPath, mode,  workflows, defaultProfile,  selectedProfile, setSelectedProfile, focusedRule, workflowSelection, setWorkflowSelection, showJson, setShowJson, setCreating, setConfirmDelete, profileIds, currentWorkflow, currentProfileDoc, currentProfile, updateProfile, updateWorkflow, drill, setWorkspaceDefault, revertCurrent } = model;
  return (
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
            canEdit={!isBuiltinWorkflowPath(currentWorkflow.path)}
            dirty={isDirty(currentWorkflow)}
            onRevert={revertCurrent}
            onDelete={() => setConfirmDelete(true)}
          />
          {isBuiltinWorkflowPath(currentWorkflow.path) ? (
            <div className={styles.section}><Button onClick={() => setCreating("workflows")}>Customize a copy</Button></div>
          ) : null}
          <fieldset disabled={isBuiltinWorkflowPath(currentWorkflow.path)} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          {isBuiltinWorkflowPath(currentWorkflow.path) ? <p className={styles.muted}>Built into Rusty · available in every project.</p> : null}
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
              flowIds={workflows.map((doc) => workflowId(doc.document)).filter((id) => id !== workflowId(currentWorkflow.document))}
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
  );
};
