import React from "react";
import { Trash2 } from "lucide-react";
import { Button, Field, Input, Textarea } from "../../../lib/ui";
import { Select } from "./ChoiceSelect";
import { type Issue, type Json, type JsonObject, edgesOf, isObject, removeEdge, removeStep, replaceEdge, stepIssues, stepsOf } from "../model";
import { IssueList, JsonField, assign, optionalNumber } from "./InspectorFields";
import styles from "./Behaviors.module.css";
import { useStepInspector } from "./useStepInspector";
import { AgentStepFields } from "./AgentStepFields";
import { VerifyStepFields } from "./VerifyStepFields";
import { SubflowStepFields } from "./SubflowStepFields";
import { ApprovalStepFields } from "./ApprovalStepFields";
import { InputStepFields } from "./InputStepFields";
import { OutputStepFields } from "./OutputStepFields";

export type WorkflowSelection = { kind: "workflow" } | { kind: "step"; id: string } | { kind: "edge"; id: string };

export interface WorkflowInspectorProps {
  workflow: JsonObject;
  selection: WorkflowSelection;
  issues: Issue[];
  profileIds: string[];
  /** The ids of the other workflows a subflow step may run. */
  flowIds?: string[];
  onChange: (workflow: JsonObject) => void;
  onSelect: (selection: WorkflowSelection) => void;
  onDrill: (profileId: string | undefined) => void;
}

export const WorkflowInspector: React.FC<WorkflowInspectorProps> = (props) => {
  const { workflow, selection } = props;
  if (selection.kind === "step") {
    const index = stepsOf(workflow).findIndex((step) => step.id === selection.id);
    if (index >= 0) return <StepInspector {...props} step={stepsOf(workflow)[index]} index={index} />;
  }
  if (selection.kind === "edge") {
    const edge = edgesOf(workflow).find((candidate) => candidate.id === selection.id);
    if (edge) return <EdgeInspector {...props} edge={edge} />;
  }
  return <WorkflowSettings {...props} />;
};

const WorkflowSettings: React.FC<WorkflowInspectorProps> = ({ workflow, issues, onChange }) => {
  const id = String(workflow.id);
  const field = (name: string) => `workflow-${id}-${name}`;
  const set = (key: string, value: Json | undefined) => onChange(assign(workflow, key, value));
  const stepCount = stepsOf(workflow).length;
  const general = issues.filter((issue) => !issue.path.startsWith("nodes"));
  const policies = isObject(workflow.policies) ? workflow.policies : {};
  return (
    <>
      {general.length ? (
        <div className={styles.section}>
          <IssueList issues={general} />
        </div>
      ) : null}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Workflow</div>
        <Field id={field("name")} label="Name">
          <Input id={field("name")} value={String(workflow.name ?? "")} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field id={field("description")} label="Description">
          <Textarea
            id={field("description")}
            rows={2}
            value={String(workflow.description ?? "")}
            onChange={(e) => set("description", e.target.value)}
          />
        </Field>
        <div className={styles.row}>
          <Field id={field("revision")} label="Revision">
            <Input
              id={field("revision")}
              type="number"
              min={1}
              value={String(workflow.revision ?? 1)}
              onChange={(e) => set("revision", optionalNumber(e.target.value) ?? 1)}
            />
          </Field>
          <Field id={field("status")} label="Status">
            <Select
              id={field("status")}
              value={String(workflow.status ?? "published")}
              onChange={(e) => set("status", e.target.value)}
              options={[
                { value: "draft", label: "Draft" },
                { value: "published", label: "Published" },
                { value: "deprecated", label: "Deprecated" },
              ]}
            />
          </Field>
        </div>
        <p className={styles.muted}>
          {stepCount} step{stepCount === 1 ? "" : "s"}. Select a step or an edge on the canvas to edit it; drag
          from a step's right handle to another step to connect them.
        </p>
      </div>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Optional limits</div>
        <p className={styles.muted}>Leave a field empty for no workflow limit. You can stop a running workflow at any time.</p>
        <div className={styles.row}>
          {([
            ["max_steps", "Steps"], ["max_total_attempts", "Total attempts"],
            ["max_elapsed_ms", "Duration (seconds)"], ["stall_timeout_ms", "Stall timeout (seconds)"], ["max_model_requests", "Model requests"],
            ["max_tool_calls", "Tool calls"], ["max_tokens", "Tokens"], ["max_cost_usd", "Cost (USD)"],
          ] as const).map(([key, label]) => (
            <Field key={key} id={field(key)} label={label}>
              <Input id={field(key)} type="number" min={key === "max_cost_usd" ? 0.01 : 1}
                step={key === "max_cost_usd" ? 0.01 : 1} placeholder="No limit"
                value={typeof policies[key] === "number" ? String(Number(policies[key]) / (key === "max_elapsed_ms" || key === "stall_timeout_ms" ? 1000 : 1)) : ""}
                onChange={(e) => {
                  const value = optionalNumber(e.target.value);
                  set("policies", assign(policies, key, value === undefined ? undefined : value * (key === "max_elapsed_ms" || key === "stall_timeout_ms" ? 1000 : 1)));
                }} />
            </Field>
          ))}
        </div>
      </div>
      <details className={styles.section}>
        <summary>Advanced data contracts (JSON workflows)</summary>
        <JsonField
          id={field("output")}
          label="Output contract"
          hint="Optional. By default the result is the text of the output step; set this only to check it against a schema."
          value={workflow.output_contract}
          onChange={(value) => set("output_contract", value)}
        />
        <JsonField
          id={field("input")}
          label="Input schema"
          optional
          value={workflow.input_schema ?? undefined}
          onChange={(value) => set("input_schema", value)}
        />
      </details>
    </>
  );
};

/** Where a new task queue reads its plan: the first step this one is bound to. */
const StepInspector: React.FC<WorkflowInspectorProps & { step: JsonObject; index: number }> = (props) => {
  const model = useStepInspector(props);
  const { workflow, step, index, issues, onChange, onSelect } = props;
  const { stepId, field, type, update } = model;
  return (
    <>
      <div className={styles.section}>
        <IssueList issues={stepIssues(issues, index, stepId)} />
        <div className={styles.row}>
          <Field id={field("name")} label="Name">
            <Input id={field("name")} value={String(step.name ?? "")} onChange={(e) => update({ ...step, name: e.target.value })} />
          </Field>
          <Field id={field("id")} label="Id">
            <Input id={field("id")} className={styles.mono} value={stepId} readOnly />
          </Field>
        </div>
      </div>

      {type === "agent" ? <AgentStepFields model={model} /> : null}

      {type === "verify" ? <VerifyStepFields model={model} /> : null}

      {type === "subflow" ? <SubflowStepFields model={model} /> : null}

      {type === "approval" ? <ApprovalStepFields model={model} /> : null}

      {type === "input" ? <InputStepFields model={model} /> : null}

      {type === "output" ? <OutputStepFields model={model} /> : null}

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Optional step limits</div>
        <div className={styles.row}>
          <Field id={field("attempts")} label="Attempts" hint="One attempt by default; increase to enable retries.">
            <Input
              id={field("attempts")}
              type="number"
              min={1}
              max={10}
              value={String(isObject(step.retry) ? (step.retry.max_attempts ?? 1) : 1)}
              onChange={(e) =>
                update({ ...step, retry: { ...(isObject(step.retry) ? step.retry : {}), max_attempts: optionalNumber(e.target.value) ?? 1 } })
              }
            />
          </Field>
          <Field id={field("timeout")} label="Timeout (seconds)">
            <Input
              id={field("timeout")}
              type="number"
              min={1}
              placeholder="No limit"
              value={step.timeout_ms == null ? "" : String(Number(step.timeout_ms) / 1000)}
              onChange={(e) => { const value = optionalNumber(e.target.value); update(assign(step, "timeout_ms", value === undefined ? undefined : value * 1000)); }}
            />
          </Field>
        </div>
        <details>
        <summary>Advanced data mapping</summary>
        <JsonField
          id={field("bindings")}
          label="Input bindings"
          optional
          value={step.input_bindings}
          onChange={(value) => update(assign(step, "input_bindings", value))}
        />
        <JsonField
          id={field("schema")}
          label="Output schema"
          optional
          value={step.output_schema ?? undefined}
          onChange={(value) => update(assign(step, "output_schema", value))}
        />
        </details>
        <div className={styles.inlineActions}>
          <Button
            type="button"
            variant="danger"
            icon={<Trash2 size={14} />}
            onClick={() => {
              onChange(removeStep(workflow, stepId));
              onSelect({ kind: "workflow" });
            }}
          >
            Delete step
          </Button>
        </div>
      </div>
    </>
  );
};

const EdgeInspector: React.FC<WorkflowInspectorProps & { edge: JsonObject }> = ({ workflow, edge, onChange, onSelect }) => {
  const id = String(edge.id);
  const name = (stepId: Json) => {
    const step = stepsOf(workflow).find((candidate) => candidate.id === stepId);
    return String(step?.name ?? stepId);
  };
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Edge</div>
      <p className={styles.muted}>
        {name(edge.source)} → {name(edge.target)}
      </p>
      <Field id={`edge-${id}-condition`} label="Follow when the source step">
        <Select
          id={`edge-${id}-condition`}
          value={String(edge.condition)}
          onChange={(e) => onChange(replaceEdge(workflow, id, { ...edge, condition: e.target.value }))}
          options={[
            { value: "on_success", label: "succeeds" },
            { value: "on_failure", label: "fails" },
          ]}
        />
      </Field>
      <div className={styles.inlineActions}>
        <Button
          type="button"
          variant="danger"
          icon={<Trash2 size={14} />}
          onClick={() => {
            onChange(removeEdge(workflow, id));
            onSelect({ kind: "workflow" });
          }}
        >
          Delete edge
        </Button>
      </div>
    </div>
  );
};
