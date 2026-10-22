/**
 * The workflow bar's step list: each step in run order with its progress
 * in the latest run, and the research a step asked for right after it.
 */

import React from "react";
import { Loader2 } from "lucide-react";
import type { WorkflowStepProgress, WorkflowStepStatus } from "../../../harness/core/workflowRun";
import type { WorkflowResearchProgress, WorkflowRunView } from "./workflowRunStore";
import { type BarStep, RESEARCH_LABEL, STATUS_LABEL } from "./workflowBarModel";
import styles from "./AgentWorkflowBar.module.css";

const STATUS_CLASS: Record<WorkflowStepStatus, string> = {
  running: styles.running,
  waiting: styles.waiting,
  asking: styles.waiting,
  retry: styles.waiting,
  succeeded: styles.succeeded,
  failed: styles.failed,
};

const RESEARCH_CLASS: Record<WorkflowResearchProgress["status"], string> = {
  running: styles.running,
  done: styles.succeeded,
  failed: styles.failed,
};

interface StepItemProps {
  step: BarStep;
  first: boolean;
  current: boolean;
  progress?: WorkflowStepProgress;
}

function stepClassName(progress: WorkflowStepProgress | undefined, current: boolean): string {
  return `${styles.step} ${progress ? STATUS_CLASS[progress.status] : ""} ${current ? styles.current : ""}`;
}

const StepItem: React.FC<StepItemProps> = ({ step, first, current, progress }) => {
  const label = progress ? STATUS_LABEL[progress.status] : "not run";
  return (
    <li
      className={stepClassName(progress, current)}
      aria-current={current ? "step" : undefined}
      title={progress?.message ?? `${step.name}: ${label}`}
      aria-label={`${step.name}: ${label}`}
    >
      {first ? null : <span className={styles.arrow} aria-hidden>→</span>}
      {progress?.status === "running" ? <Loader2 size={11} className={styles.spin} aria-hidden /> : null}
      <span>{step.name}</span>
      {progress && progress.attempt > 1 ? <span className={styles.attempt}>×{progress.attempt}</span> : null}
    </li>
  );
};

const ResearchItem: React.FC<{ entry: WorkflowResearchProgress; stepName: string }> = ({ entry, stepName }) => (
  <li
    className={`${styles.step} ${styles.research} ${RESEARCH_CLASS[entry.status]}`}
    title={`Research asked by ${stepName}: ${entry.question}`}
    aria-label={`Research for ${stepName}: ${RESEARCH_LABEL[entry.status]}`}
    data-testid="workflow-research-step"
  >
    <span className={styles.arrow} aria-hidden>↳</span>
    {entry.status === "running" ? <Loader2 size={11} className={styles.spin} aria-hidden /> : null}
    <span>Research</span>
  </li>
);

interface WorkflowStepListProps {
  steps: BarStep[];
  /** The run whose progress to show; undefined shows every step as not run. */
  run?: WorkflowRunView;
  activeStepId?: string;
}

export const WorkflowStepList: React.FC<WorkflowStepListProps> = ({ steps, run, activeStepId }) => (
  <ol className={styles.steps} aria-label="Workflow steps">
    {steps.map((step, index) => (
      <React.Fragment key={step.id}>
        <StepItem step={step} first={index === 0} current={step.id === activeStepId} progress={run?.steps[step.id]} />
        {(run?.research ?? []).filter((entry) => entry.nodeId === step.id).map((entry) => (
          <ResearchItem key={entry.callId} entry={entry} stepName={step.name} />
        ))}
      </React.Fragment>
    ))}
    {run?.status === "failed" && run.error ? <li className={styles.error}>{run.error}</li> : null}
  </ol>
);
