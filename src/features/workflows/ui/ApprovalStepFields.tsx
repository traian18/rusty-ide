import { Field, Input, Textarea } from "../../../lib/ui";
import { Select } from "./ChoiceSelect";
import { isObject } from "../model";
import { optionalNumber } from "./InspectorFields";
import styles from "./Behaviors.module.css";
import type { StepInspectorModel } from "./useStepInspector";

export const ApprovalStepFields: React.FC<{ model: StepInspectorModel }> = ({ model }) => {
  const { stepId, field, config, setConfig, otherSteps, upstream, step } = model;
  return (
    <>
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
          <label style={{ display: "block" }}>
            <input
              type="checkbox"
              checked={config.revise_on_notes === true}
              onChange={(e) => setConfig("revise_on_notes", e.target.checked ? true : undefined)}
            />{" "}
            Notes given with an approval revise the result first (it is not asked again)
          </label>
        </div>
    </>
  );
};
