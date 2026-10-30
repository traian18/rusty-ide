import { Field, Textarea } from "../../../lib/ui";
import { Select } from "./ChoiceSelect";
import { type JsonObject, isObject } from "../model";
import { assign } from "./InspectorFields";
import styles from "./Behaviors.module.css";
import type { StepInspectorModel } from "./useStepInspector";

export const SubflowStepFields: React.FC<{ model: StepInspectorModel }> = ({ model }) => {
  const { field, config, setConfig, profileIds, flowIds } = model;
  return (
    <>
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
    </>
  );
};
