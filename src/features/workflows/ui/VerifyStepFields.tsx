import { Field } from "../../../lib/ui";
import { Select } from "./ChoiceSelect";
import { JsonField } from "./InspectorFields";
import styles from "./Behaviors.module.css";
import type { StepInspectorModel } from "./useStepInspector";

export const VerifyStepFields: React.FC<{ model: StepInspectorModel }> = ({ model }) => {
  const { field, config, setConfig, otherSteps } = model;
  return (
    <>
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
    </>
  );
};
