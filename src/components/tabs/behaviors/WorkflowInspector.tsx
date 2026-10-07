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
import { ToolSelector } from "./ToolSelector";

export type WorkflowSelection = { kind: "workflow" } | { kind: "step"; id: string } | { kind: "edge"; id: string };

interface WorkflowInspectorProps {
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
function upstreamPlanBinding(step: JsonObject): string {
  const bindings = Array.isArray(step.input_bindings) ? (step.input_bindings as JsonObject[]) : [];
  const plan = bindings.find((binding) => isObject(binding.source) && binding.source.type === "node_output" && binding.target === "plan");
  return String(plan?.target ?? "plan");
}

/** A task queue as built-in flows use it: an "ask me" failure policy and a read-only reviewer. */
function taskQueueDefaults(profileIds: string[], plan: string): JsonObject {
  const reviewer = profileIds.find((id) => id === "review" || id.endsWith(".review")) ?? "review";
  return {
    plan_pointer: `/${plan}`,
    review_profile: { id: reviewer },
    review_instructions: "Review the change made for workflow_input.task against its acceptance criteria. Read the changed code; do not edit. Give evidence from the workspace for each criterion the task names.",
    max_repairs: 2,
    on_task_failure: "ask",
  };
}

const StepInspector: React.FC<WorkflowInspectorProps & { step: JsonObject; index: number }> = ({
  workflow,
  step,
  index,
  issues,
  profileIds,
  flowIds = [],
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
  const upstream = new Set<string>();
  const pending = [stepId];
  while (pending.length) {
    const target = pending.pop();
    for (const edge of edgesOf(workflow)) {
      const source = String(edge.source);
      if (edge.target === target && edge.condition === "on_success" && !upstream.has(source)) {
        upstream.add(source);
        pending.push(source);
      }
    }
  }

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
            <label style={{ display: "block" }}>
              <input
                type="checkbox"
                checked={isObject(config.task_queue)}
                onChange={(e) => setConfig("task_queue", e.target.checked ? taskQueueDefaults(profileIds, upstreamPlanBinding(step)) : undefined)}
              />{" "}
              Run the plan as a task queue
            </label>
            {isObject(config.task_queue) ? (
              <JsonField
                id={field("task-queue")}
                label="Task queue and reviewer"
                hint="Runs every planned task in a fresh builder and reviewer session. Accepted tasks are saved before continuing. The review profile, full review instructions and local repair limit are shown here."
                value={config.task_queue}
                onChange={(value) => setConfig("task_queue", value)}
              />
            ) : null}
            {config.structured_output === "text" ? (
              <div>
                <div className={styles.sectionTitle}>Context from earlier steps</div>
                <p className={styles.muted}>Selected final messages are included alongside this step's instructions.</p>
                <label style={{ display: "block" }}>
                  <input type="checkbox" checked={Array.isArray(step.input_bindings) && (step.input_bindings as JsonObject[]).some((binding) => isObject(binding.source) && binding.source.type === "run_input")}
                    onChange={(e) => {
                      const bindings = (Array.isArray(step.input_bindings) ? step.input_bindings as JsonObject[] : []).filter((binding) => !isObject(binding.source) || binding.source.type !== "run_input");
                      update({ ...step, input_bindings: e.target.checked ? [...bindings, { target: "request", source: { type: "run_input", pointer: "/request" } }] : bindings });
                    }} /> Original request
                </label>
                {otherSteps.filter((candidate) => upstream.has(String(candidate.id)) && (candidate.type === "agent" || candidate.type === "input")).map((candidate) => {
                  const bindings = Array.isArray(step.input_bindings) ? step.input_bindings as JsonObject[] : [];
                  const matches = (binding: JsonObject) => isObject(binding.source) && binding.source.type === "node_output" && binding.source.node_id === candidate.id;
                  return <label key={String(candidate.id)} style={{ display: "block" }}>
                    <input type="checkbox" checked={bindings.some(matches)} onChange={(e) => update({ ...step,
                      input_bindings: e.target.checked
                        ? [...bindings, { target: String(candidate.id), source: { type: "node_output", node_id: candidate.id, pointer: "" } }]
                        : bindings.filter((binding) => !matches(binding)),
                    })} /> {String(candidate.name ?? candidate.id)}
                  </label>;
                })}
              </div>
            ) : null}
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
          <ToolSelector value={Array.isArray(tools.tools) ? tools.tools.filter((tool): tool is string => typeof tool === "string") : []}
            onChange={(selected) => setConfig("tools", { type: "allow_list", tools: selected })} />
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
            <Field id={field("structured")} label="Response format" hint="Text passes the final message directly to the next agent.">
              <Select
                id={field("structured")}
                value={String(config.structured_output ?? "require")}
                onChange={(e) => update({ ...step,
                  config: { ...config, structured_output: e.target.value },
                  output_schema: { type: "inline", name: `${stepId}_output`, schema: e.target.value === "text" ? { type: "string" } : { type: "object" } },
                })}
                options={[
                  { value: "text", label: "Text / Markdown" },
                  { value: "require", label: "Require the provider's structured output" },
                  { value: "host_validated_fallback", label: "Provider's, else host validation" },
                  { value: "host_validated", label: "JSON with host validation" },
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
            hint='[{"type": "criteria", "pointer": "/check/criteria"}] judges each criterion: fail sends the work back, manual (only a person can check it) moves on and is listed for the user. Also: {"type": "schema"}, {"type": "required_status", "pointer": "/status", "equals": "done"}, {"type": "artifact_exists", "pointer": "/path"}'
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

      {type === "subflow" ? (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Subflow</div>
          <p className={styles.muted}>
            Runs another workflow, or a single step, in the middle of this one: to research something first, fix a bug found on the way, and so on. What is bound to this step is its input; its result is this step's output.
          </p>
          {(() => {
            const target = isObject(config.target) ? config.target : { type: "step", instructions: "" };
            const kind = target.type === "flow" ? "flow" : "step";
            const setTarget = (next: JsonObject) => setConfig("target", next);
            return (
              <>
                <Field id={field("target-kind")} label="Run">
                  <Select
                    id={field("target-kind")}
                    value={kind}
                    onChange={(e) => setTarget(e.target.value === "flow"
                      ? { type: "flow", id: flowIds[0] ?? "" }
                      : { type: "step", instructions: String(target.instructions ?? "Gather what the next steps need.") })}
                    options={[
                      { value: "step", label: "A single step" },
                      { value: "flow", label: "A saved workflow" },
                    ]}
                  />
                </Field>
                {kind === "flow" ? (
                  <Field id={field("target-flow")} label="Workflow">
                    <Select
                      id={field("target-flow")}
                      value={String(target.id ?? "")}
                      onChange={(e) => setTarget({ type: "flow", id: e.target.value })}
                      options={[
                        { value: "", label: "Select a workflow" },
                        ...(target.id && !flowIds.includes(String(target.id)) ? [{ value: String(target.id), label: `${String(target.id)} (not found)` }] : []),
                        ...flowIds.map((id) => ({ value: id, label: id })),
                      ]}
                    />
                  </Field>
                ) : (
                  <>
                    <Field id={field("target-profile")} label="Profile">
                      <Select
                        id={field("target-profile")}
                        value={isObject(target.profile) ? String(target.profile.id ?? "") : ""}
                        onChange={(e) => setTarget(assign(target, "profile", e.target.value ? { id: e.target.value } : undefined))}
                        options={[{ value: "", label: "Session default" }, ...profileIds.map((id) => ({ value: id, label: id }))]}
                      />
                    </Field>
                    <Field id={field("target-instructions")} label="Instructions">
                      <Textarea
                        id={field("target-instructions")}
                        rows={4}
                        value={String(target.instructions ?? "")}
                        onChange={(e) => setTarget({ ...target, instructions: e.target.value })}
                      />
                    </Field>
                  </>
                )}
              </>
            );
          })()}
        </div>
      ) : null}

      {type === "approval" ? (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Approval</div>
          <p className={styles.muted}>
            The run waits until you approve, ask for changes, or reject. Asking for changes sends your notes back and runs the steps in between again.
          </p>
          <Field id={field("subject")} label="Review the result of">
            <Select
              id={field("subject")}
              value={isObject(config.subject) ? String(config.subject.node_id ?? "") : ""}
              onChange={(e) => setConfig("subject", { type: "node_output", node_id: e.target.value, pointer: "" })}
              options={[
                { value: "", label: "Select a step" },
                ...otherSteps
                  .filter((candidate) => upstream.has(String(candidate.id)) && candidate.type !== "input")
                  .map((candidate) => ({ value: String(candidate.id), label: String(candidate.name ?? candidate.id) })),
              ]}
            />
          </Field>
          <Field id={field("prompt")} label="Question" hint="Shown above what you review.">
            <Textarea
              id={field("prompt")}
              rows={2}
              placeholder={`Review ${String(step.name ?? stepId)} before the workflow continues.`}
              value={String(config.prompt ?? "")}
              onChange={(e) => setConfig("prompt", e.target.value || undefined)}
            />
          </Field>
          <Field id={field("revise")} label="Requested changes go to">
            <Select
              id={field("revise")}
              value={typeof config.revise_target === "string" ? config.revise_target : ""}
              onChange={(e) => setConfig("revise_target", e.target.value || undefined)}
              options={[
                { value: "", label: "The step being reviewed" },
                ...otherSteps
                  .filter((candidate) => upstream.has(String(candidate.id)) && candidate.type === "agent")
                  .map((candidate) => ({ value: String(candidate.id), label: String(candidate.name ?? candidate.id) })),
              ]}
            />
          </Field>
          <div className={styles.row}>
            <Field id={field("revisions")} label="Times changes may be asked for">
              <Input
                id={field("revisions")}
                type="number"
                min={0}
                max={10}
                value={String(config.max_revisions ?? 5)}
                onChange={(e) => setConfig("max_revisions", optionalNumber(e.target.value) ?? 0)}
              />
            </Field>
            <Field id={field("skip")} label="Skip when empty at" hint="A JSON pointer into what is reviewed; nothing there means nothing to ask.">
              <Input
                id={field("skip")}
                className={styles.mono}
                placeholder="never skip"
                value={typeof config.skip_if_empty === "string" ? config.skip_if_empty : ""}
                onChange={(e) => setConfig("skip_if_empty", e.target.value === "" ? undefined : e.target.value)}
              />
            </Field>
          </div>
          <label style={{ display: "block" }}>
            <input
              type="checkbox"
              checked={config.allow_auto_approve === false}
              onChange={(e) => setConfig("allow_auto_approve", e.target.checked ? false : undefined)}
            />{" "}
            Always ask a person, even when the run auto-approves
          </label>
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
          <Field id={field("result-step")} label="Show the final message from">
            <Select id={field("result-step")} value={isObject(config.source) ? String(config.source.node_id ?? "") : ""}
              options={[{ value: "", label: "Select a step" }, ...otherSteps.map((candidate) => ({ value: String(candidate.id), label: String(candidate.name ?? candidate.id) }))]}
              onChange={(e) => {
                const source = { type: "node_output", node_id: e.target.value, pointer: "" };
                const next = replaceStep(workflow, stepId, { ...step, config: { ...config, source } });
                // A custom output contract names its source too; keep it in step.
                onChange(isObject(workflow.output_contract) && "source" in workflow.output_contract
                  ? { ...next, output_contract: { ...workflow.output_contract, source } } : next);
              }} />
          </Field>
          <details><summary>Advanced source mapping</summary>
          <JsonField
            id={field("source")}
            label="Source"
            hint='{"type": "node_output", "node_id": "…", "pointer": ""} or {"type": "run_input", "pointer": ""}'
            value={config.source}
            onChange={(value) => setConfig("source", value)}
          />
          </details>
        </div>
      ) : null}

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
