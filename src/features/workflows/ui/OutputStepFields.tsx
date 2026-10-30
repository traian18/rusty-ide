import { Field } from "../../../lib/ui";
import { Select } from "./ChoiceSelect";
import { isObject, replaceStep } from "../model";
import { JsonField } from "./InspectorFields";
import styles from "./Behaviors.module.css";
import type { StepInspectorModel } from "./useStepInspector";

export const OutputStepFields: React.FC<{ model: StepInspectorModel }> = ({ model }) => {
  const { stepId, field, config, setConfig, otherSteps, workflow, step, onChange } = model;
  return (
    <>
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
    </>
  );
};
