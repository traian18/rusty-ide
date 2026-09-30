/**
 * Inspector for a workflow (orchestration definition): the workflow itself,
 * one step, or one edge — whichever is selected on the canvas.
 */

import React from "react";
import { ChevronRight, Trash2 } from "lucide-react";
import { Button, Field, Input, Textarea } from "../../ui";
import { Select } from "./ChoiceSelect";
import {
  type Issue,
  type Json,
  type JsonObject,
  edgesOf,
  isObject,
  parseNameList,
  removeEdge,
  removeStep,
  replaceEdge,
  replaceStep,
  stepConfig,
  stepIssues,
  stepProfile,
  stepsOf,
} from "./behaviorModel";
import { IssueList, JsonField, assign, optionalNumber } from "./InspectorFields";
import styles from "./Behaviors.module.css";

export type WorkflowSelection = { kind: "workflow" } | { kind: "step"; id: string } | { kind: "edge"; id: string };

interface WorkflowInspectorProps {
  workflow: JsonObject;
  selection: WorkflowSelection;
  issues: Issue[];
  profileIds: string[];
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
        <div className={styles.sectionTitle}>Contract and budgets</div>
        <JsonField
          id={field("output")}
          label="Output contract"
          hint="The schema the workflow's result must match, and which step produces it."
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
        <JsonField
          id={field("policies")}
          label="Policies"
          optional
          hint="max_steps, max_total_attempts, max_elapsed_ms, max_model_requests, max_tool_calls, max_tokens, max_cost_usd"
          value={workflow.policies}
          onChange={(value) => set("policies", value)}
        />
      </div>
    </>
  );
};

const StepInspector: React.FC<WorkflowInspectorProps & { step: JsonObject; index: number }> = ({
  workflow,
  step,
  index,
  issues,
  profileIds,
  onChange,
  onSelect,
  onDrill,
}) => {
  const stepId = String(step.id);
  const field = (name: string) => `step-${stepId}-${name}`;
  const type = String(step.type);
  const config = stepConfig(step);
  const update = (next: JsonObject) => onChange(replaceStep(workflow, stepId, next));
  const setConfig = (key: string, value: Json | undefined) => update({ ...step, config: assign(config, key, value) });
  const tools = isObject(config.tools) ? config.tools : { type: "none" };
  const profile = stepProfile(step);
  const otherSteps = stepsOf(workflow).filter((candidate) => candidate.id !== stepId);

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

      {type === "agent" ? (
        <>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Behavior</div>
            <Field
              id={field("profile")}
              label="Profile"
              hint="How this step's agent behaves: instructions, rules, and its completion gate."
            >
              <Select
                id={field("profile")}
                value={profile ?? ""}
                onChange={(e) => setConfig("profile", e.target.value ? { id: e.target.value } : undefined)}
                options={[
                  { value: "", label: "Session default" },
                  ...(profile && !profileIds.includes(profile) ? [{ value: profile, label: `${profile} (missing)` }] : []),
                  ...profileIds.map((id) => ({ value: id, label: id })),
                ]}
              />
            </Field>
            <div className={styles.inlineActions}>
              <Button type="button" variant="primary" icon={<ChevronRight size={14} />} onClick={() => onDrill(profile)}>
                {profile ? `Open ${profile}` : "Design a profile for this step"}
              </Button>
            </div>
          </div>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Step</div>
            <Field id={field("instructions")} label="Instructions">
              <Textarea
                id={field("instructions")}
                rows={6}
                value={String(config.instructions ?? "")}
                onChange={(e) => setConfig("instructions", e.target.value)}
              />
            </Field>
            <Field id={field("tools")} label="Tools">
              <Select
                id={field("tools")}
                value={String(tools.type ?? "none")}
                onChange={(e) =>
                  setConfig("tools", e.target.value === "allow_list" ? { type: "allow_list", tools: [] } : { type: e.target.value })
                }
                options={[
                  { value: "inherit", label: "Everything the session has" },
                  { value: "allow_list", label: "Only these tools" },
                  { value: "none", label: "No tools" },
                ]}
              />
            </Field>
            {tools.type === "allow_list" ? (
              <Field id={field("allow")} label="Allowed tools" hint="One name or glob per line">
                <Textarea
                  id={field("allow")}
                  rows={3}
                  className={styles.mono}
                  value={Array.isArray(tools.tools) ? tools.tools.join("\n") : ""}
                  onChange={(e) => setConfig("tools", { type: "allow_list", tools: parseNameList(e.target.value) })}
                />
              </Field>
            ) : null}
            <div className={styles.row}>
              <Field id={field("context")} label="Context">
                <Select
                  id={field("context")}
                  value={String(config.context_mode ?? "isolated_child")}
                  onChange={(e) => setConfig("context_mode", e.target.value)}
                  options={[
                    { value: "isolated_child", label: "Isolated" },
                    { value: "shared_session", label: "Shared session" },
                  ]}
                />
              </Field>
              <Field id={field("model")} label="Model">
                <Input
                  id={field("model")}
                  placeholder="session model"
                  value={String(config.model ?? "")}
                  onChange={(e) => setConfig("model", e.target.value)}
                />
              </Field>
            </div>
            <Field id={field("structured")} label="Structured output">
              <Select
                id={field("structured")}
                value={String(config.structured_output ?? "require")}
                onChange={(e) => setConfig("structured_output", e.target.value)}
                options={[
                  { value: "require", label: "Require the provider's structured output" },
                  { value: "host_validated_fallback", label: "Provider's, else host validation" },
                  { value: "host_validated", label: "Always host validation (works with tools on any model)" },
                ]}
              />
            </Field>
          </div>
        </>
      ) : null}

      {type === "verify" ? (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Verification</div>
          <JsonField
            id={field("checks")}
            label="Checks"
            hint='[{"type": "schema"}, {"type": "required_status", "pointer": "/status", "equals": "done"}, {"type": "artifact_exists", "pointer": "/path"}]'
            value={config.checks}
            onChange={(value) => setConfig("checks", value ?? [])}
          />
          <Field id={field("retry")} label="On failure, retry" hint="Re-runs that step with the failure as feedback.">
            <Select
              id={field("retry")}
              value={typeof config.retry_target === "string" ? config.retry_target : ""}
              onChange={(e) => setConfig("retry_target", e.target.value || undefined)}
              options={[
                { value: "", label: "Nothing (follow on_failure edges)" },
                ...otherSteps.map((candidate) => ({ value: String(candidate.id), label: String(candidate.name ?? candidate.id) })),
              ]}
            />
          </Field>
        </div>
      ) : null}

      {type === "input" ? (
        <div className={styles.section}>
          <JsonField
            id={field("defaults")}
            label="Input defaults"
            value={config.defaults}
            onChange={(value) => setConfig("defaults", value ?? {})}
          />
        </div>
      ) : null}

      {type === "output" ? (
        <div className={styles.section}>
          <JsonField
            id={field("source")}
            label="Source"
            hint='{"type": "node_output", "node_id": "…", "pointer": ""} or {"type": "run_input", "pointer": ""}'
            value={config.source}
            onChange={(value) => setConfig("source", value)}
          />
        </div>
      ) : null}

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Advanced</div>
        <div className={styles.row}>
          <Field id={field("attempts")} label="Max attempts">
            <Input
              id={field("attempts")}
              type="number"
              min={1}
              value={String(isObject(step.retry) ? (step.retry.max_attempts ?? 1) : 1)}
              onChange={(e) =>
                update({ ...step, retry: { ...(isObject(step.retry) ? step.retry : {}), max_attempts: optionalNumber(e.target.value) ?? 1 } })
              }
            />
          </Field>
          <Field id={field("timeout")} label="Timeout (ms)">
            <Input
              id={field("timeout")}
              type="number"
              min={1}
              value={step.timeout_ms === undefined ? "" : String(step.timeout_ms)}
              onChange={(e) => update(assign(step, "timeout_ms", optionalNumber(e.target.value)))}
            />
          </Field>
        </div>
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
