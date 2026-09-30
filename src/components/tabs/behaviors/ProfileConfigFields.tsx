import { Button, Input, Textarea } from "../../ui";
import { Select } from "./ChoiceSelect";
import { isObject, type Json, type JsonObject } from "./behaviorModel";
import { assign, optionalNumber } from "./InspectorFields";
import { ConditionEditor, names } from "./ConditionEditor";
import { PROFILE_TOOLS, ToolSelector } from "./ToolSelector";
import { ValueFields } from "./ValueFields";
import styles from "./Behaviors.module.css";

const toolOptions = (saved: string[] = []) => [...PROFILE_TOOLS, ...saved.filter((id) => !PROFILE_TOOLS.some((tool) => tool.id === id)).map((id) => ({ id, label: id }))].map((tool) => ({ value: tool.id, label: tool.label }));

export function ToolOverrides({ value, onChange }: { value: Json | undefined; onChange: (value: JsonObject) => void }) {
  const overrides = isObject(value) ? value : {};
  return <div className={styles.configGroup}>
    <div className={styles.sectionTitle}>Per-tool settings</div>
    {Object.entries(overrides).map(([tool, raw]) => {
      const config = isObject(raw) ? raw : {};
      const update = (next: JsonObject) => onChange({ ...overrides, [tool]: next });
      return <div key={tool} className={styles.configGroup}>
        <strong>{PROFILE_TOOLS.find((entry) => entry.id === tool)?.label ?? tool}</strong>
        <label>Permission<Select aria-label={`${tool} permission`} value={String(config.permission ?? "")}
          options={[{ value: "", label: "Session default" }, { value: "allow", label: "Allow if session permits" }, { value: "ask", label: "Ask before running" }, { value: "deny", label: "Deny" }]}
          onChange={(event) => update(assign(config, "permission", event.target.value || undefined))} /></label>
        <label>Extra instructions<Textarea aria-label={`${tool} extra instructions`} rows={3} value={String(config.description_append ?? "")} onChange={(event) => update(assign(config, "description_append", event.target.value || undefined))} /></label>
        <Button onClick={() => onChange(Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== tool)))}>Remove tool settings</Button>
      </div>;
    })}
    <Select aria-label="Add tool settings" value="" options={[{ value: "", label: "Choose a tool to configure…" }, ...toolOptions().filter((tool) => !Object.prototype.hasOwnProperty.call(overrides, tool.value))]}
      onChange={(event) => { if (event.target.value) onChange({ ...overrides, [event.target.value]: {} }); }} />
  </div>;
}

function EvaluatorFields({ value, onChange }: { value: JsonObject; onChange: (value: JsonObject) => void }) {
  const type = String(value.type);
  const text = (key: string, title: string, optional = false) => <label>{title}<Textarea aria-label={title} rows={3} value={String(value[key] ?? "")} onChange={(event) => onChange(assign(value, key, optional ? event.target.value || undefined : event.target.value))} /></label>;
  const number = (key: string, title: string, fallback: number) => <label>{title}<Input aria-label={title} type="number" min={1} value={value[key] === undefined ? "" : String(value[key])} placeholder={String(fallback)} onChange={(event) => onChange(assign(value, key, optionalNumber(event.target.value)))} /></label>;
  return <div className={styles.configGroup}>
    {type === "tool" ? <>
      <Select aria-label="Check tool" value={String(value.tool ?? "read_file")} options={toolOptions(names(value.tool))} onChange={(event) => onChange({ ...value, tool: event.target.value })} />
      <ValueFields label="Check arguments" value={value.args ?? {}} onChange={(args) => onChange({ ...value, args })} />
    </> : null}
    {type === "model" || type === "agent" ? <>
      {text("instructions", "Review instructions")}{text("model", "Reviewer model (optional)", true)}
      {number("transcript_messages", "Recent messages to review", 10)}
    </> : null}
    {type === "agent" ? <><ToolSelector value={names(value.tools)} onChange={(tools) => onChange({ ...value, tools })} />{number("max_turns", "Reviewer turn limit", 8)}</> : null}
    {type === "command" ? <>{text("command", "Check command")}{number("timeout_ms", "Command timeout (ms)", 60000)}<p className={styles.muted}>Runs only when this session trusts profile commands.</p></> : null}
  </div>;
}

export function CompletionGateFields({ value, onChange, profileIds }: { value: Json | undefined; onChange: (value: Json | undefined) => void; profileIds: string[] }) {
  const gate = isObject(value) ? value : undefined;
  if (!gate) return <Button onClick={() => onChange({ checks: [{ id: "check-1", require: { calls: { tool: ["run_command"], gte: 1 } }, feedback: "Run the relevant checks before finishing." }], max_continuations: 3, on_exhausted: "fail" })}>Add completion check</Button>;
  const checks = Array.isArray(gate.checks) ? gate.checks.filter(isObject) : [];
  const update = (index: number, check: JsonObject) => onChange({ ...gate, checks: checks.map((old, i) => i === index ? check : old) });
  return <div className={styles.configGroup}>
    <div className={styles.row}>
      <label>Additional attempts<Input aria-label="Completion additional attempts" type="number" min={0} value={gate.max_continuations === undefined ? "" : String(gate.max_continuations)} placeholder="3" onChange={(event) => onChange(assign(gate, "max_continuations", optionalNumber(event.target.value)))} /></label>
      <label>If checks still fail<Select aria-label="When completion checks are exhausted" value={String(gate.on_exhausted ?? "accept")} options={[{ value: "fail", label: "Fail the run" }, { value: "accept", label: "Finish with checks not passed" }]} onChange={(event) => onChange({ ...gate, on_exhausted: event.target.value })} /></label>
    </div>
    {checks.map((check, index) => {
      const evaluator = isObject(check.evaluator) ? check.evaluator : undefined;
      const type = evaluator ? String(evaluator.type) : "condition";
      return <div key={index} className={styles.configGroup}>
        <label>Check name<Input aria-label={`Check ${index + 1} name`} value={String(check.id ?? "")} onChange={(event) => update(index, { ...check, id: event.target.value })} /></label>
        <Select aria-label={`Check ${index + 1} method`} value={type} options={[{ value: "condition", label: "Check tool activity" }, { value: "tool", label: "Run a tool" }, { value: "model", label: "Ask a model" }, { value: "agent", label: "Ask a reviewer agent" }, { value: "command", label: "Run a command" }]}
          onChange={(event) => {
            const next = { ...check }; delete next.require; delete next.evaluator;
            if (event.target.value === "condition") next.require = { calls: { tool: ["run_command"], gte: 1 } };
            else next.evaluator = event.target.value === "tool" ? { type: "tool", tool: "read_file", args: {} }
              : event.target.value === "command" ? { type: "command", command: "" } : { type: event.target.value, instructions: "Verify that the requested work is complete." };
            update(index, next);
          }} />
        {evaluator ? <EvaluatorFields value={evaluator} onChange={(next) => update(index, { ...check, evaluator: next })} />
          : <ConditionEditor label={`Check ${index + 1} condition`} value={check.require} profileIds={profileIds} onChange={(require) => update(index, { ...check, require: require ?? {} })} />}
        <label>Feedback when this check fails<Textarea aria-label={`Check ${index + 1} feedback`} rows={3} value={String(check.feedback ?? "")} onChange={(event) => update(index, assign(check, "feedback", event.target.value || undefined))} /></label>
        {evaluator ? <Select aria-label={`Check ${index + 1} error behavior`} value={String(check.error_policy ?? "fail")} options={[{ value: "fail", label: "Fail if the reviewer errors" }, { value: "pass", label: "Pass if the reviewer errors" }]} onChange={(event) => update(index, { ...check, error_policy: event.target.value })} /> : null}
        <Button onClick={() => onChange({ ...gate, checks: checks.filter((_, i) => i !== index) })}>Remove check</Button>
      </div>;
    })}
    <Button onClick={() => {
      let id = `check-${checks.length + 1}`; while (checks.some((check) => check.id === id)) id += "-new";
      onChange({ ...gate, checks: [...checks, { id, require: { calls: { tool: ["run_command"], gte: 1 } }, feedback: "Run the relevant checks before finishing." }] });
    }}>Add check</Button>
    <Button onClick={() => onChange(undefined)}>Remove completion gate</Button>
  </div>;
}
