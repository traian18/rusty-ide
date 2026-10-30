import { ChevronRight } from "lucide-react";
import { taskQueueDefaults, upstreamPlanBinding } from "./stepDefaults";
import { Button, Field, Input, Textarea } from "../../../lib/ui";
import { Select } from "./ChoiceSelect";
import { type JsonObject, isObject } from "../model";
import { JsonField } from "./InspectorFields";
import styles from "./Behaviors.module.css";
import { ToolSelector } from "./ToolSelector";
import type { StepInspectorModel } from "./useStepInspector";

export const AgentStepFields: React.FC<{ model: StepInspectorModel }> = ({ model }) => {
  const { stepId, field, config, update, setConfig, tools, profile, otherSteps, accessMode, accessSteps, upstream, step, profileIds, onDrill } = model;
  return (
    <>
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
            <Field
              id={field("access")}
              label="Sees other steps"
              hint="What the chosen steps did (files changed, commands run, hand-offs, verdicts) is added after this step's input, and a step that runs again always sees its own last attempt. Plan and research steps usually judge the request afresh; a builder sent back needs everything; a verifier needs the work it checks."
            >
              <Select
                id={field("access")}
                value={accessMode}
                onChange={(e) => setConfig("context_access", e.target.value === "own" ? undefined : e.target.value === "all" ? "all" : { steps: [] })}
                options={[
                  { value: "own", label: "Only its own inputs" },
                  { value: "all", label: "All other steps" },
                  { value: "steps", label: "Chosen steps" },
                ]}
              />
            </Field>
            {accessMode === "steps" ? (
              <div data-testid="context-access-steps">
                {otherSteps.filter((candidate) => ["agent", "verify", "approval", "subflow"].includes(String(candidate.type))).map((candidate) => {
                  const id = String(candidate.id);
                  return (
                    <label key={id} style={{ display: "block" }}>
                      <input
                        type="checkbox"
                        checked={accessSteps.includes(id)}
                        onChange={(e) => setConfig("context_access", { steps: e.target.checked ? [...accessSteps, id] : accessSteps.filter((other) => other !== id) })}
                      />{" "}
                      {String(candidate.name ?? id)}
                    </label>
                  );
                })}
              </div>
            ) : null}
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
    </>
  );
};
