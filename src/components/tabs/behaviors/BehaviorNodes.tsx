/**
 * React Flow node views for the Behaviors canvas: a behavior profile, and a
 * workflow step. Both are summaries; editing happens in the inspector.
 */

import React from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { ArrowDownToLine, ArrowUpFromLine, Bot, ChevronRight, ListChecks, ShieldCheck, Sparkles, Split, UserCheck } from "lucide-react";
import type { WorkflowStepProgress } from "../../../harness/core/workflowRun";
import { type JsonObject, approvalReviseTarget, isObject, rulesOf, stepConfig, stepProfile } from "./behaviorModel";
import styles from "./Behaviors.module.css";

export interface ProfileNodeData extends Record<string, unknown> {
  profile: JsonObject;
  selected: boolean;
  readOnly: boolean;
  isDefault: boolean;
  issueCount: number;
  dirty: boolean;
}

export interface StepNodeData extends Record<string, unknown> {
  step: JsonObject;
  selected: boolean;
  issueCount: number;
  /** This step in the workflow's latest run (Agent Mode), if it ran. */
  run?: WorkflowStepProgress;
  onDrill?: (profileId: string | undefined) => void;
}

export type ProfileFlowNode = Node<ProfileNodeData, "profile">;
export type StepFlowNode = Node<StepNodeData, "step">;

function nodeClass(selected: boolean, invalid: boolean, readOnly = false) {
  return [
    styles.node,
    selected ? styles.nodeSelected : "",
    invalid ? styles.nodeInvalid : "",
    readOnly ? styles.nodeReadOnly : "",
  ].join(" ");
}

function toolSummary(tools: unknown): string {
  if (!isObject(tools)) return "inherit";
  if (tools.type === "allow_list" && Array.isArray(tools.tools)) return `${tools.tools.length} allowed`;
  return String(tools.type ?? "inherit");
}

export const ProfileNode: React.FC<NodeProps<ProfileFlowNode>> = ({ data }) => {
  const { profile, selected, readOnly, isDefault, issueCount, dirty } = data;
  const rules = rulesOf(profile);
  const instructions = isObject(profile.instructions) ? String(profile.instructions.text ?? "") : "";
  const gate = isObject(profile.completion_gate) && Array.isArray(profile.completion_gate.checks)
    ? profile.completion_gate.checks.length
    : 0;
  return (
    <div className={nodeClass(selected, issueCount > 0, readOnly)}>
      <Handle type="target" position={Position.Left} className={styles.handle} />
      <div className={styles.nodeHeader}>
        <Sparkles size={14} className={styles.nodeIcon} />
        <span className={styles.nodeName}>{String(profile.name ?? profile.id)}</span>
        {isDefault ? <span className={styles.badge}>default</span> : null}
        {readOnly ? <span className={styles.badge}>built-in</span> : null}
        {issueCount > 0 ? <span className={`${styles.badge} ${styles.badgeDanger}`}>{issueCount}</span> : null}
        {dirty ? <span className={styles.dot} title="Unsaved changes" /> : null}
      </div>
      <div className={styles.nodeBody}>
        <div className={styles.nodeLine}>
          <span>id</span>
          <span className={`${styles.nodeValue} ${styles.mono}`}>{String(profile.id)}</span>
        </div>
        <div className={styles.nodeLine}>
          <span>tools</span>
          <span className={styles.nodeValue}>{toolSummary(profile.tools)}</span>
        </div>
        <div className={styles.nodeLine}>
          <span>rules</span>
          <span className={styles.nodeValue}>{rules.length}</span>
        </div>
        <div className={styles.nodeLine}>
          <span>completion gate</span>
          <span className={styles.nodeValue}>{gate ? `${gate} check${gate === 1 ? "" : "s"}` : "none"}</span>
        </div>
        {instructions ? <div className={styles.nodeText}>{instructions}</div> : null}
      </div>
      <Handle type="source" position={Position.Right} className={styles.handle} />
    </div>
  );
};

const RUN_BADGE: Record<WorkflowStepProgress["status"], string> = {
  running: styles.badgeRunning,
  waiting: styles.badgeWarning,
  asking: styles.badgeWarning,
  retry: styles.badgeWarning,
  succeeded: styles.badgeSuccess,
  failed: styles.badgeDanger,
};

const STEP_ICONS = {
  input: { Icon: ArrowDownToLine, className: styles.nodeIconInput },
  agent: { Icon: Bot, className: "" },
  verify: { Icon: ShieldCheck, className: styles.nodeIconVerify },
  approval: { Icon: UserCheck, className: styles.nodeIconVerify },
  subflow: { Icon: Split, className: "" },
  output: { Icon: ArrowUpFromLine, className: styles.nodeIconOutput },
} as const;

export const StepNode: React.FC<NodeProps<StepFlowNode>> = ({ data }) => {
  const { step, selected, issueCount, run, onDrill } = data;
  const type = String(step.type) as keyof typeof STEP_ICONS;
  const { Icon, className } = STEP_ICONS[type] ?? { Icon: ListChecks, className: "" };
  const config = stepConfig(step);
  const profile = stepProfile(step);
  return (
    <div className={nodeClass(selected, issueCount > 0)}>
      {type !== "input" ? <Handle type="target" position={Position.Left} className={styles.handle} /> : null}
      <div className={styles.nodeHeader}>
        <Icon size={14} className={`${styles.nodeIcon} ${className}`} />
        <span className={styles.nodeName}>{String(step.name ?? step.id)}</span>
        <span className={styles.badge}>{type}</span>
        {run ? (
          <span className={`${styles.badge} ${RUN_BADGE[run.status]}`} title={run.message}>
            {run.status === "running" && run.attempt > 1 ? `attempt ${run.attempt}` : run.status}
          </span>
        ) : null}
        {issueCount > 0 ? <span className={`${styles.badge} ${styles.badgeDanger}`}>{issueCount}</span> : null}
      </div>
      <div className={styles.nodeBody}>
        <div className={styles.nodeLine}>
          <span>id</span>
          <span className={`${styles.nodeValue} ${styles.mono}`}>{String(step.id)}</span>
        </div>
        {type === "agent" ? (
          <>
            <div className={styles.nodeLine}>
              <span>tools</span>
              <span className={styles.nodeValue}>{toolSummary(config.tools)}</span>
            </div>
            {config.instructions ? <div className={styles.nodeText}>{String(config.instructions)}</div> : null}
            <div className={styles.nodeLine}>
              <span>profile</span>
              <button
                type="button"
                className={`${styles.drill} nodrag`}
                onClick={(event) => {
                  event.stopPropagation();
                  onDrill?.(profile);
                }}
              >
                {profile ?? "session default"}
                <ChevronRight size={12} />
              </button>
            </div>
          </>
        ) : null}
        {type === "verify" ? (
          <div className={styles.nodeLine}>
            <span>checks</span>
            <span className={styles.nodeValue}>{Array.isArray(config.checks) ? config.checks.length : 0}</span>
          </div>
        ) : null}
        {type === "verify" && typeof config.retry_target === "string" ? (
          <div className={styles.nodeLine}>
            <span>retries</span>
            <span className={`${styles.nodeValue} ${styles.mono}`}>{config.retry_target}</span>
          </div>
        ) : null}
        {type === "subflow" ? (
          <div className={styles.nodeLine}>
            <span>runs</span>
            <span className={`${styles.nodeValue} ${styles.mono}`}>
              {isObject(config.target) && config.target.type === "flow" ? String(config.target.id || "—") : "a step"}
            </span>
          </div>
        ) : null}
        {type === "subflow" && isObject(config.target) && config.target.type === "step" && config.target.instructions ? (
          <div className={styles.nodeText}>{String(config.target.instructions)}</div>
        ) : null}
        {type === "approval" ? (
          <>
            <div className={styles.nodeLine}>
              <span>reviews</span>
              <span className={`${styles.nodeValue} ${styles.mono}`}>
                {isObject(config.subject) ? String(config.subject.node_id ?? "run input") : "—"}
              </span>
            </div>
            <div className={styles.nodeLine}>
              <span>changes go to</span>
              <span className={`${styles.nodeValue} ${styles.mono}`}>{approvalReviseTarget(step) ?? "—"}</span>
            </div>
            <div className={styles.nodeLine}>
              <span>auto-approve</span>
              <span className={styles.nodeValue}>{config.allow_auto_approve === false ? "always asks" : "allowed"}</span>
            </div>
            {config.revise_on_notes === true ? (
              <div className={styles.nodeLine}>
                <span>approval notes</span>
                <span className={styles.nodeValue}>revise first</span>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      {type !== "output" ? <Handle type="source" position={Position.Right} className={styles.handle} /> : null}
    </div>
  );
};

export const behaviorNodeTypes = { profile: ProfileNode, step: StepNode };
