/**
 * AgentWorkflowBar — the Agent chat's workflow control, above the input.
 *
 * Picks whether this chat runs a single agent loop or follows a saved
 * workflow (`.rusty/workflows`), says so plainly, and while a run is going
 * shows each step's progress in order.
 */

import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Check, Loader2, PencilLine, Workflow as WorkflowIcon, X } from "lucide-react";
import { Button, IconButton } from "../../ui";
import { Select } from "./ChoiceSelect";
import type { WorkflowStepStatus } from "../../../harness/core/workflowRun";
import { type JsonObject, layoutSteps, stepsOf } from "./behaviorModel";
import type { WorkflowRunView } from "./workflowRunStore";
import styles from "./AgentWorkflowBar.module.css";
import { isStarterWorkflowPath } from "./starterFlow";

export interface WorkflowChoice {
  path: string;
  name: string;
}

export interface AgentWorkflowBarProps {
  workflows: WorkflowChoice[];
  /** Path of the workflow this chat follows. */
  selected?: string;
  /** The selected workflow's document, for its steps. */
  definition?: JsonObject;
  /** The selected workflow's latest run. */
  run?: WorkflowRunView;
  /** This chat is running the workflow right now. */
  running: boolean;
  /** The choice cannot change (a run is in progress). */
  disabled: boolean;
  onSelect: (path: string | undefined) => void;
  /** Open the Behaviors tab on `path`, or to create a workflow. */
  onEdit: (path: string | undefined) => void;
}

const SINGLE = "";

const STATUS_CLASS: Record<WorkflowStepStatus, string> = {
  running: styles.running,
  waiting: styles.waiting,
  retry: styles.waiting,
  succeeded: styles.succeeded,
  failed: styles.failed,
};

const STATUS_LABEL: Record<WorkflowStepStatus, string> = {
  running: "running",
  waiting: "waiting for permission",
  retry: "retrying",
  succeeded: "done",
  failed: "failed",
};

export const AgentWorkflowBar: React.FC<AgentWorkflowBarProps> = ({
  workflows,
  selected,
  definition,
  run,
  running,
  disabled,
  onSelect,
  onEdit,
}) => {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("rusty_workflow_bar_collapsed") === "true"; } catch { return false; }
  });
  const toggleCollapsed = () => {
    setCollapsed(!collapsed);
    try { localStorage.setItem("rusty_workflow_bar_collapsed", String(!collapsed)); } catch { /* optional preference */ }
  };
  const current = workflows.find((workflow) => workflow.path === selected);
  const name = current?.name ?? (selected ? selected.split("/").pop() ?? selected : "");

  // Steps in the order they run (left to right on the canvas).
  const steps = useMemo(() => {
    if (!definition) return [];
    const positions = layoutSteps(definition);
    return stepsOf(definition)
      .map((step) => ({ id: String(step.id), name: String(step.name ?? step.id), position: positions.get(String(step.id)) }))
      .sort((a, b) => (a.position?.x ?? 0) - (b.position?.x ?? 0) || (a.position?.y ?? 0) - (b.position?.y ?? 0));
  }, [definition]);

  const options = [
    { value: SINGLE, label: "Single agent" },
    ...workflows.map((workflow) => ({ value: workflow.path, label: `Workflow: ${workflow.name}` })),
    ...(selected && !current ? [{ value: selected, label: `Workflow: ${name} (missing)` }] : []),
  ];

  const showRun = Boolean(selected && run && (running || run.status !== "running"));
  const currentIndex = running && run?.current ? steps.findIndex((step) => step.id === run.current) : -1;
  const activeStep = currentIndex >= 0 ? steps[currentIndex] : undefined;
  const currentProgress = activeStep ? run?.steps[activeStep.id] : undefined;
  const summary = !selected
    ? "Each message runs one agent loop."
    : running
      ? activeStep
        ? `Running step ${currentIndex + 1} of ${steps.length}: ${activeStep.name}${
            currentProgress?.status === "waiting" ? " (waiting for permission)" : currentProgress && currentProgress.attempt > 1 ? ` (attempt ${currentProgress.attempt})` : ""
          }`
        : "Starting the workflow…"
      : run && run.status !== "running"
        ? `Last run ${run.status}. Your next message runs it again.`
        : "Your next message runs this workflow.";

  if (collapsed) return (
    <div className={styles.collapsed}>
      <Button type="button" variant="ghost" icon={<ChevronDown size={14} />} aria-expanded={false} onClick={toggleCollapsed}>Show workflow</Button>
      <span className={styles.summary}>{running ? activeStep ? `Running: ${activeStep.name}` : "Workflow running…" : name || "Single agent"}</span>
    </div>
  );

  return (
    <div className={`${styles.bar} ${selected ? styles.active : ""}`} aria-label="Workflow">
      <div className={styles.row}>
        <IconButton icon={<ChevronUp size={14} />} label="Hide workflow bar" aria-expanded={true} onClick={toggleCollapsed} />
        <WorkflowIcon size={14} className={styles.icon} aria-hidden />
        <label className={styles.label} htmlFor="agent-workflow-select">
          Mode
        </label>
        <Select
          id="agent-workflow-select"
          className={styles.select}
          value={selected ?? SINGLE}
          disabled={disabled}
          onChange={(event) => onSelect(event.target.value || undefined)}
          options={options}
        />
        {selected ? (
          <span className={styles.chip} data-testid="workflow-chip">
            {running ? <Loader2 size={12} className={styles.spin} aria-hidden /> : <Check size={12} aria-hidden />}
            {name}
            {!disabled ? (
              <IconButton icon={<X size={12} />} label="Stop following this workflow" size="sm" onClick={() => onSelect(undefined)} />
            ) : null}
          </span>
        ) : null}
        <span className={styles.summary}>{summary}</span>
        <Button type="button" variant="ghost" icon={<PencilLine size={14} />} onClick={() => onEdit(selected)}>
          {selected ? isStarterWorkflowPath(selected) ? "View workflow" : "Edit workflow" : workflows.length ? "Design workflows" : "Create a workflow"}
        </Button>
      </div>
      {selected && steps.length ? (
        <ol className={styles.steps} aria-label="Workflow steps">
          {steps.map((step, index) => {
            const progress = showRun ? run?.steps[step.id] : undefined;
            const label = progress ? STATUS_LABEL[progress.status] : "not run";
            return (
              <li
                key={step.id}
                className={`${styles.step} ${progress ? STATUS_CLASS[progress.status] : ""} ${step.id === activeStep?.id ? styles.current : ""}`}
                aria-current={step.id === activeStep?.id ? "step" : undefined}
                title={progress?.message ?? `${step.name}: ${label}`}
                aria-label={`${step.name}: ${label}`}
              >
                {index > 0 ? <span className={styles.arrow} aria-hidden>→</span> : null}
                {progress?.status === "running" ? <Loader2 size={11} className={styles.spin} aria-hidden /> : null}
                <span>{step.name}</span>
                {progress && progress.attempt > 1 ? <span className={styles.attempt}>×{progress.attempt}</span> : null}
              </li>
            );
          })}
          {showRun && run?.status === "failed" && run.error ? <li className={styles.error}>{run.error}</li> : null}
        </ol>
      ) : null}
    </div>
  );
};
