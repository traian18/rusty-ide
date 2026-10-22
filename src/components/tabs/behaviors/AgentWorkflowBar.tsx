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
import { type JsonObject } from "./behaviorModel";
import type { WorkflowRunView } from "./workflowRunStore";
import styles from "./AgentWorkflowBar.module.css";
import { WorkflowStepList } from "./WorkflowStepList";
import {
  IDLE_NOTICE_MS,
  SINGLE,
  type WorkflowBarView,
  type WorkflowChoice,
  formatQuiet,
  orderedSteps,
  workflowBarView,
} from "./workflowBarModel";

export { IDLE_NOTICE_MS, formatQuiet, type WorkflowChoice } from "./workflowBarModel";

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
  /** Approval steps pass without asking (only those that allow it). */
  autoApprove?: boolean;
  onAutoApproveChange?: (enabled: boolean) => void;
  /** Stops the running workflow; offered from the "no activity" notice. */
  onStop?: () => void;
  onSelect: (path: string | undefined) => void;
}

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

const COLLAPSED_KEY = "rusty_workflow_bar_collapsed";

/** Remembers the collapsed state across reloads. It is only a preference:
 * without storage the bar still toggles, it just starts expanded. */
function rememberCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, String(collapsed));
  } catch (error) {
    console.debug("Could not remember whether the workflow bar is collapsed:", error);
  }
}

function useCollapsedPreference(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === "true"; } catch { return false; }
  });
  const toggle = () => {
    setCollapsed(!collapsed);
    rememberCollapsed(!collapsed);
  };
  return [collapsed, toggle];
}

const IdleNotice: React.FC<{ quietMs: number; stallMs?: number; onStop?: () => void }> = ({ quietMs, stallMs, onStop }) => {
  if (quietMs < IDLE_NOTICE_MS) return null;
  return (
    <div className={`${styles.idle} ${stallMs && quietMs >= stallMs * 0.6 ? styles.idleWarn : ""}`} role="status" data-testid="workflow-idle">
      <span>
        No activity for {formatQuiet(quietMs)}. It may be a long tool call or a slow model.
        {stallMs ? ` If nothing happens for ${formatQuiet(stallMs)}, the step is cancelled and retried automatically.` : ""}
      </span>
      {onStop ? <button type="button" className={styles.idleStop} onClick={onStop}>Stop workflow</button> : null}
    </div>
  );
};

const WorkflowChip: React.FC<{ name: string; running: boolean; disabled: boolean; onClear: () => void }> = ({ name, running, disabled, onClear }) => (
  <span className={styles.chip} data-testid="workflow-chip">
    {running ? <Loader2 size={12} className={styles.spin} aria-hidden /> : <Check size={12} aria-hidden />}
    {name}
    {!disabled ? (
      <IconButton icon={<X size={12} />} label="Stop following this workflow" size="sm" onClick={onClear} />
    ) : null}
  </span>
);

const HANDS_OVER_TITLE = "After each step Rusty checks whether what it found means another workflow is the right one, and hands over with the work so far. Switching to a workflow that edits files asks you first.";
const NO_HANDOVER_TITLE = "This workflow does not declare any workflow to hand over to.";
const AUTO_APPROVE_TITLE = "Approval steps (such as reviewing the plan) pass without asking you. Steps that must always be seen by a person still ask, and so do questions about failures.";

interface ToggleProps {
  title: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}

const Toggle: React.FC<ToggleProps> = ({ title, checked, disabled, onChange, children }) => (
  <label className={styles.toggle} title={title}>
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
    {children}
  </label>
);

type WorkflowTogglesProps = Pick<AgentWorkflowBarProps, "disabled" | "flowSwitching" | "onFlowSwitchingChange" | "autoApprove" | "onAutoApproveChange"> & {
  view: WorkflowBarView;
};

const WorkflowToggles: React.FC<WorkflowTogglesProps> = ({
  view,
  disabled,
  flowSwitching = false,
  onFlowSwitchingChange,
  autoApprove = false,
  onAutoApproveChange,
}) => (
  <>
    {onFlowSwitchingChange ? (
      <Toggle title={view.handsOver ? HANDS_OVER_TITLE : NO_HANDOVER_TITLE} checked={flowSwitching} disabled={disabled} onChange={onFlowSwitchingChange}>
        Allow flow switching
      </Toggle>
    ) : null}
    {onAutoApproveChange && view.hasApprovals ? (
      <Toggle title={AUTO_APPROVE_TITLE} checked={autoApprove} disabled={disabled} onChange={onAutoApproveChange}>
        Auto-approve
      </Toggle>
    ) : null}
  </>
);

export const AgentWorkflowBar: React.FC<AgentWorkflowBarProps> = (props) => {
  const { workflows, selected, definition, run, running, disabled, onSelect } = props;
  const now = useNow(running);
  const [collapsed, toggleCollapsed] = useCollapsedPreference();
  const steps = useMemo(() => orderedSteps(definition), [definition]);
  const view = workflowBarView({ workflows, selected, definition, run, running, autoAvailable: props.autoAvailable ?? false, steps, now });

  if (collapsed) return (
    <div className={styles.collapsed}>
      <span className={styles.summary}>{view.collapsedSummary}</span>
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
          options={view.options}
        />
        {selected ? <WorkflowChip name={view.name} running={running} disabled={disabled} onClear={() => onSelect(undefined)} /> : null}
        {selected && steps.length ? <WorkflowStepList steps={steps} run={view.shownRun} activeStepId={view.activeStep?.id} /> : null}
        <span className={styles.summary}>
          {view.summary}
        </span>
      </div>
      <IdleNotice quietMs={view.quietMs} stallMs={view.stallMs} onStop={props.onStop} />
      {selected ? (
        <WorkflowToggles
          view={view}
          disabled={disabled}
          flowSwitching={props.flowSwitching}
          onFlowSwitchingChange={props.onFlowSwitchingChange}
          autoApprove={props.autoApprove}
          onAutoApproveChange={props.onAutoApproveChange}
        />
      ) : null}
    </div>
  );
};
