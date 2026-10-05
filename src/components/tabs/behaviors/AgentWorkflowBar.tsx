/**
 * AgentWorkflowBar — the Agent chat's workflow control, above the input.
 *
 * Picks whether this chat runs a single agent loop or follows a saved
 * workflow (`.rusty/workflows`), says so plainly, and while a run is going
 * shows each step's progress in order.
 */

import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Check, Loader2, Workflow as WorkflowIcon, X } from "lucide-react";
import { IconButton } from "../../ui";
import { Select } from "./ChoiceSelect";
import { type WorkflowStepStatus } from "../../../harness/core/workflowRun";
import { type JsonObject, layoutSteps, stepsOf } from "./behaviorModel";
import type { WorkflowRunView } from "./workflowRunStore";
import styles from "./AgentWorkflowBar.module.css";
import { AUTO_FLOW, workflowSwitchTargets } from "./flowCatalog";
import type { BuiltinWorkflowKind } from "./starterFlow";

export interface WorkflowChoice {
  path: string;
  name: string;
  /** A stage is a short run that stops at a handoff to review; the rest run a whole pipeline. */
  kind?: BuiltinWorkflowKind;
  description?: string;
  /** Short id (without the built-in namespace), what the router and `switch_to` refer to. */
  id?: string;
  /** When the router should pick it (`metadata.route.when`); absent means it is never auto-picked. */
  route?: string;
  /** Whether any step can change files. */
  edits?: boolean;
  /** Ids it may hand over to mid-run (`metadata.switch_to`). */
  switchTo?: string[];
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
  /** Rusty can choose the workflow for each message (OpenRouter and a JEV model are connected). */
  autoAvailable?: boolean;
  /** A running workflow may hand over to another at a step boundary. */
  flowSwitching?: boolean;
  onFlowSwitchingChange?: (allowed: boolean) => void;
  /** Stops the running workflow; offered from the "no activity" notice. */
  onStop?: () => void;
  onSelect: (path: string | undefined) => void;
}

const SINGLE = "";

/** Quiet time before the bar says a step has gone silent. */
export const IDLE_NOTICE_MS = 60_000;

/** Current time, ticking once a second while `active`. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function formatQuiet(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

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
  autoAvailable = false,
  flowSwitching = false,
  onFlowSwitchingChange,
  onStop,
  onSelect,
}) => {
  const now = useNow(running);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("rusty_workflow_bar_collapsed") === "true"; } catch { return false; }
  });
  const toggleCollapsed = () => {
    setCollapsed(!collapsed);
    try { localStorage.setItem("rusty_workflow_bar_collapsed", String(!collapsed)); } catch { /* optional preference */ }
  };
  const auto = selected === AUTO_FLOW;
  // With Auto, `definition` is the workflow Rusty chose for the latest message.
  const chosen = typeof definition?.name === "string" ? definition.name : undefined;
  const current = auto ? undefined : workflows.find((workflow) => workflow.path === selected);
  const name = auto
    ? chosen ? `Auto · ${chosen}` : "Auto"
    : current?.name ?? (selected ? selected.split("/").pop() ?? selected : "");

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
    ...(autoAvailable || auto ? [{ value: AUTO_FLOW, label: autoAvailable ? "Auto: choose a workflow for each message" : "Auto (needs OpenRouter and a JEV model)" }] : []),
    ...workflows.map((workflow) => ({ value: workflow.path, label: `${workflow.kind === "stage" ? "Stage" : "Workflow"}: ${workflow.name}` })),
    ...(selected && !current ? [{ value: selected, label: `Workflow: ${name} (missing)` }] : []),
  ];

  const handsOver = auto || workflowSwitchTargets(definition).length > 0;
  const showRun = Boolean(selected && run && (running || run.status !== "running"));
  const currentIndex = running && run?.current ? steps.findIndex((step) => step.id === run.current) : -1;
  const activeStep = currentIndex >= 0 ? steps[currentIndex] : undefined;
  const currentProgress = activeStep ? run?.steps[activeStep.id] : undefined;
  const summary = running
    ? activeStep
      ? `Running step ${currentIndex + 1} of ${steps.length}: ${activeStep.name}${
          currentProgress?.status === "waiting" ? " (waiting for permission)" : currentProgress && currentProgress.attempt > 1 ? ` (attempt ${currentProgress.attempt})` : ""
        }`
      : "Starting the workflow…"
    : "";

  // A step that is only waiting on the user is not stuck, and a paused-for-permission step has nothing to report.
  const quietMs = running && run && currentProgress?.status !== "waiting" ? now - run.lastActivityAt : 0;
  const stallLimit = (definition?.policies as { stall_timeout_ms?: unknown } | undefined)?.stall_timeout_ms;
  const stallMs = typeof stallLimit === "number" && stallLimit > 0 ? stallLimit : undefined;
  const idleNotice = quietMs >= IDLE_NOTICE_MS ? (
    <div className={`${styles.idle} ${stallMs && quietMs >= stallMs * 0.6 ? styles.idleWarn : ""}`} role="status" data-testid="workflow-idle">
      <span>
        No activity for {formatQuiet(quietMs)}. It may be a long tool call or a slow model.
        {stallMs ? ` If nothing happens for ${formatQuiet(stallMs)}, the step is cancelled and retried automatically.` : ""}
      </span>
      {onStop ? <button type="button" className={styles.idleStop} onClick={onStop}>Stop workflow</button> : null}
    </div>
  ) : null;

  if (collapsed) return (
    <div className={styles.collapsed}>
      <span className={styles.summary}>{running ? activeStep ? `Running: ${activeStep.name}` : "Workflow running…" : name || "Single agent"}</span>
      <IconButton icon={<ChevronDown size={14} />} label="Show workflow bar" aria-expanded={false} onClick={toggleCollapsed} />
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
        <span className={styles.summary}>
          {summary}
        </span>
      </div>
      {idleNotice}
      {selected && onFlowSwitchingChange ? (
        <label
          className={styles.toggle}
          title={handsOver
            ? "After each step Rusty checks whether what it found means another workflow is the right one, and hands over with the work so far. Switching to a workflow that edits files asks you first."
            : "This workflow does not declare any workflow to hand over to."}
        >
          <input
            type="checkbox"
            checked={flowSwitching}
            disabled={disabled}
            onChange={(event) => onFlowSwitchingChange(event.target.checked)}
          />
          Allow flow switching
        </label>
      ) : null}
    </div>
  );
};
