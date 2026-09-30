import { Button, Input, Textarea } from "../../ui";
import { Select } from "./ChoiceSelect";
import { isObject, type Json } from "./behaviorModel";
import styles from "./Behaviors.module.css";

/** Typed argument values, including nested structures, without JSON syntax. */
export function ValueFields({ value, onChange, label = "Value" }: { value: Json; onChange: (value: Json) => void; label?: string }) {
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const defaults: Record<string, Json> = { string: "", number: 0, boolean: false, null: null, object: {}, array: [] };
  return <div className={styles.configGroup}>
    <Select aria-label={`${label} type`} value={type} onChange={(event) => onChange(defaults[event.target.value])}
      options={[{ value: "string", label: "Text" }, { value: "number", label: "Number" }, { value: "boolean", label: "Yes / no" }, { value: "null", label: "Empty / remove value" }, { value: "object", label: "Fields" }, { value: "array", label: "List" }]} />
    {typeof value === "string" ? <Textarea aria-label={label} rows={2} value={value} onChange={(event) => onChange(event.target.value)} /> : null}
    {typeof value === "number" ? <Input aria-label={label} type="number" step="any" value={value} onChange={(event) => { const number = Number(event.target.value); if (Number.isFinite(number)) onChange(number); }} /> : null}
    {typeof value === "boolean" ? <Select aria-label={label} value={String(value)} options={[{ value: "true", label: "Yes" }, { value: "false", label: "No" }]} onChange={(event) => onChange(event.target.value === "true")} /> : null}
    {isObject(value) ? <>
      {Object.entries(value).map(([key, entry], index) => <div className={styles.configGroup} key={index}>
        <Input aria-label={`${label} field ${index + 1} name`} value={key} onChange={(event) => {
          const name = event.target.value;
          if (name !== key && Object.prototype.hasOwnProperty.call(value, name)) return;
          onChange(Object.fromEntries(Object.entries(value).map(([old, content]) => [old === key ? name : old, content])));
        }} />
        <ValueFields label={`${label} ${key}`} value={entry} onChange={(next) => onChange({ ...value, [key]: next })} />
        <Button onClick={() => onChange(Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)))}>Remove field</Button>
      </div>)}
      <Button onClick={() => { let name = "field"; while (Object.prototype.hasOwnProperty.call(value, name)) name += "_"; onChange({ ...value, [name]: "" }); }}>Add field</Button>
    </> : null}
    {Array.isArray(value) ? <>
      {value.map((entry, index) => <div className={styles.configGroup} key={index}>
        <ValueFields label={`${label} item ${index + 1}`} value={entry} onChange={(next) => onChange(value.map((old, i) => i === index ? next : old))} />
        <Button onClick={() => onChange(value.filter((_, i) => i !== index))}>Remove item</Button>
      </div>)}
      <Button onClick={() => onChange([...value, ""])}>Add item</Button>
    </> : null}
  </div>;
}
