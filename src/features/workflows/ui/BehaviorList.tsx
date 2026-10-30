import React from "react";
import { FileJson, Workflow as WorkflowIcon } from "lucide-react";
import { Callout } from "../../../lib/ui";
import { profileId, workflowId } from "../model";
import { isBuiltinWorkflowPath } from "../model/starterFlow";
import styles from "./Behaviors.module.css";
import { StatusDot } from "./StatusDot";
import { isDirty } from "./documents";
import type { BehaviorsTabModel } from "./useBehaviorsTab";

// The names it reads from the tab model are destructured below.
export const BehaviorList: React.FC<{ model: BehaviorsTabModel }> = ({ model }) => {
  const {  mode, profiles, workflows, builtins, defaultProfile, failures, loading, issues, selectedProfile, selectedWorkflow, setSelectedWorkflow, setWorkflowSelection, setShowJson, selectProfile } = model;
  return (
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
              {isBuiltinWorkflowPath(doc.path) ? <span className={styles.badge}>Built-in</span> : <StatusDot dirty={isDirty(doc)} issues={issues[doc.path]} />}
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
  );
};
