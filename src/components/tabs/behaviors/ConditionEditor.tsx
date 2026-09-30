import { Button, Input } from "../../ui";
import { Select } from "./ChoiceSelect";
import { isObject, type Json } from "./behaviorModel";
import { assign, optionalNumber } from "./InspectorFields";
import { ToolSelector } from "./ToolSelector";
import { ValueFields } from "./ValueFields";
import styles from "./Behaviors.module.css";

const kinds = [
  ["always", "Always"], ["tool", "Tool matches"], ["arg", "Tool argument matches"],
  ["result_contains", "Tool result contains text"], ["turn", "Turn number"],
  ["calls", "Tool call count"], ["turns_since_call", "Turns since a tool ran"],
  ["since_last_call", "Tools run after another tool"], ["repeated_call", "Repeated identical calls"],
  ["profile_entered_from", "Previous profile"], ["all", "All conditions"], ["any", "Any condition"], ["not", "Condition is not met"],
];
const defaults: Record<string, Json> = {
  always: {}, tool: ["read_file"], arg: { pointer: "/path", contains: "" }, result_contains: "",
  turn: { gte: 1 }, calls: { tool: ["read_file"], gte: 1 }, turns_since_call: { tool: ["read_file"], gte: 1 },
  since_last_call: { of: ["write_file"], called: ["run_command"], gte: 1 }, repeated_call: { gte: 3 },
  profile_entered_from: "", all: [{ tool: ["read_file"] }], any: [{ tool: ["read_file"] }], not: { tool: ["read_file"] },
};
export const names = (value: Json | undefined): string[] => typeof value === "string" ? [value] : Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

export function ConditionEditor({ value, onChange, profileIds, label = "Condition", optional = false }: {
  value: Json | undefined; onChange: (value: Json | undefined) => void; profileIds: string[]; label?: string; optional?: boolean;
}) {
  const object = isObject(value) ? value : {};
  const kind = Object.keys(object)[0] ?? "always";
  const body = object[kind];
  const data = isObject(body) ? body : {};
  const set = (next: Json) => onChange({ [kind]: next });
  const tools = (key: string, title: string) => <div><p className={styles.muted}>{title}</p><ToolSelector value={names(data[key])} onChange={(selected) => set({ ...data, [key]: selected })} /></div>;
  return <div className={styles.configGroup}>
    <Select aria-label={label} value={kind} options={kinds.filter(([key]) => key !== "always" || optional).map(([key, title]) => ({ value: key, label: title }))}
      onChange={(event) => onChange(event.target.value === "always" ? undefined : { [event.target.value]: defaults[event.target.value] })} />
    {kind === "tool" ? <ToolSelector value={names(body)} onChange={set} /> : null}
    {kind === "profile_entered_from" ? <div role="group" aria-label="Previous profiles">{[...new Set([...profileIds, ...names(body)])].map((id) => <label key={id} className={styles.toolOption}><input type="checkbox" checked={names(body).includes(id)} onChange={(event) => set(event.target.checked ? [...names(body), id] : names(body).filter((name) => name !== id))} />{id}</label>)}</div> : null}
    {kind === "result_contains" ? <Input aria-label="Result contains" value={String(body ?? "")} onChange={(event) => set(event.target.value)} /> : null}
    {["calls", "turns_since_call"].includes(kind) ? tools("tool", "Count calls of these tools") : null}
    {kind === "since_last_call" ? <>{tools("of", "After these tools")}{tools("called", "Require these tools afterwards")}</> : null}
    {["turn", "calls", "turns_since_call", "since_last_call", "repeated_call"].includes(kind) ? <div className={styles.row}>
      {[["eq", "Exactly"], ["gte", "At least"], ["lte", "At most"]].map(([key, title]) => <label key={key}>{title}<Input aria-label={`${label} ${title}`} type="number" min={0} placeholder="Not set" value={data[key] === undefined ? "" : String(data[key])} onChange={(event) => set(assign(data, key, optionalNumber(event.target.value)))} /></label>)}
    </div> : null}
    {kind === "arg" ? <>
      <label>Argument path<Input aria-label="Argument path" placeholder="/path" value={String(data.pointer ?? "")} onChange={(event) => set({ ...data, pointer: event.target.value })} /></label>
      {[["glob", "Matches pattern"], ["contains", "Contains text"]].map(([key, title]) => <label key={key}>{title}<Input aria-label={title} value={String(data[key] ?? "")} onChange={(event) => set(assign(data, key, event.target.value || undefined))} /></label>)}
      <label><input type="checkbox" checked={Object.prototype.hasOwnProperty.call(data, "equals")} onChange={(event) => set(assign(data, "equals", event.target.checked ? "" : undefined))} />Equals a value</label>
      {Object.prototype.hasOwnProperty.call(data, "equals") ? <ValueFields label="Expected argument" value={data.equals} onChange={(next) => set({ ...data, equals: next })} /> : null}
    </> : null}
    {kind === "all" || kind === "any" ? <>
      {(Array.isArray(body) ? body : []).map((child, index, children) => <div key={index} className={styles.configGroup}>
        <ConditionEditor value={child} profileIds={profileIds} label={`${label} ${index + 1}`} onChange={(next) => set(children.map((old, i) => i === index ? next ?? {} : old))} />
        <Button onClick={() => set(children.filter((_, i) => i !== index))}>Remove condition</Button>
      </div>)}
      <Button onClick={() => set([...(Array.isArray(body) ? body : []), { tool: ["read_file"] }])}>Add condition</Button>
    </> : null}
    {kind === "not" ? <ConditionEditor value={body} profileIds={profileIds} label={`${label} negated`} onChange={(next) => set(next ?? {})} /> : null}
    {!kinds.some(([key]) => key === kind) ? <p className={styles.muted}>This saved condition is not supported by this version. It is preserved until you choose another condition.</p> : null}
  </div>;
}
