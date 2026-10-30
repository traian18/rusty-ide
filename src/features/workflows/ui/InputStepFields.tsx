import { JsonField } from "./InspectorFields";
import styles from "./Behaviors.module.css";
import type { StepInspectorModel } from "./useStepInspector";

export const InputStepFields: React.FC<{ model: StepInspectorModel }> = ({ model }) => {
  const { field, config, setConfig } = model;
  return (
    <>
        <div className={styles.section}>
          <JsonField
            id={field("defaults")}
            label="Input defaults"
            value={config.defaults}
            onChange={(value) => setConfig("defaults", value ?? {})}
          />
        </div>
    </>
  );
};
