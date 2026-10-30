import React from "react";
import { Field, Textarea } from "../../../lib/ui";
import { Select } from "./ChoiceSelect";
import { type ActionType, type JsonObject, type RuleEvent, isObject } from "../model";
import { assign } from "./InspectorFields";
import styles from "./Behaviors.module.css";
import { ValueFields } from "./ValueFields";

export const ActionFields: React.FC<{
  type: ActionType | undefined;
  body: JsonObject;
  event: RuleEvent;
  field: (name: string) => string;
  profileIds: string[];
  onChange: (body: JsonObject) => void;
}> = ({ type, body, event, field, profileIds, onChange }) => {
  const text = (key: string, label: string, hint?: string, rows = 3) => (
    <Field id={field(key)} label={label} hint={hint}>
      <Textarea id={field(key)} rows={rows} value={String(body[key] ?? "")} onChange={(e) => onChange(assign(body, key, e.target.value))} />
    </Field>
  );
  switch (type) {
    case "inject": {
      const tool = event === "PreToolUse" || event === "PostToolUse" || event === "PostToolUseFailure";
      return (
        <>
          {text("text", "Inject text", "Added to the model's context when the rule fires.", 4)}
          <Field id={field("placement")} label="Placement">
            <Select
              id={field("placement")}
              value={String(body.placement ?? "")}
              onChange={(e) => onChange(assign(body, "placement", e.target.value))}
              options={[
                { value: "", label: tool ? "Default (with the tool result)" : "Default (next request)" },
                ...(tool ? [{ value: "with_result", label: "With the tool result" }] : []),
                { value: "next_request", label: "Next request only" },
                ...(event === "RunStart" ? [{ value: "persistent", label: "Persistent (whole run)" }] : []),
              ]}
            />
          </Field>
        </>
      );
    }
    case "deny":
      return text("reason", "Reason", "Shown to the model instead of the tool result.");
    case "stop_run":
      return text("reason", "Reason", "The run ends with this message.");
    case "ask":
      return text("reason", "Reason (optional)", "Shown in the permission prompt.");
    case "allow":
      return <p className={styles.muted}>Runs the tool without asking, even if its permission is "ask".</p>;
    case "switch_profile": {
      const reference = isObject(body.profile) ? body.profile : {};
      const current = String(reference.id ?? "");
      const options = profileIds.includes(current) || !current ? profileIds : [current, ...profileIds];
      return (
        <Field id={field("target")} label="Switch to" hint="Applies before the next model request; the model is told.">
          <Select
            id={field("target")}
            value={current}
            onChange={(e) => onChange({ profile: { id: e.target.value } })}
            options={[{ value: "", label: "Choose a profile…" }, ...options.map((id) => ({ value: id, label: id }))]}
          />
        </Field>
      );
    }
    case "rewrite_args":
      return (
        <div><p className={styles.muted}>Choose fields to change in the tool call. An empty/remove value deletes a field.</p>
          <ValueFields label="Argument changes" value={body.merge ?? {}} onChange={(merge) => onChange({ ...body, merge })} />
        </div>
      );
    case "rewrite_result": {
      const mode = body.replace !== undefined ? "replace" : "append";
      return (
        <>
          <Field id={field("mode")} label="Rewrite">
            <Select
              id={field("mode")}
              value={mode}
              onChange={(e) => onChange({ [e.target.value]: String(body[mode] ?? "") })}
              options={[
                { value: "append", label: "Append to the result" },
                { value: "replace", label: "Replace the result" },
              ]}
            />
          </Field>
          {text(mode, mode === "replace" ? "Replacement" : "Appended text")}
        </>
      );
    }
    default:
      return <p className={styles.muted}>This action is not supported by this version. Its saved settings are preserved until you choose another action.</p>;
  }
};
