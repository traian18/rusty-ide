/** Running the Specify, Plan and Implement workflows on a change: what a run is, what it is asked and what it writes. */
import { finishedAgentSteps } from "../harness/core/workflowRun";
import { markdownText } from "../harness/core/markdownText";
import type { SpecsClient } from "./client";
import type { OnboardingEntry, SpecProgress, SpecRecorded, SpecStep, SpecVerification } from "./model";

export interface SpecRun {
  /** The repository folder the specs live in. */
  root: string;
  /** The change folder name, e.g. `0007-photo-albums`. */
  change: string;
  step: SpecStep;
}

/** The built-in workflow (by its short id) that does each step. */
export const SPEC_WORKFLOW: Record<SpecStep, string> = { specify: "specify", plan: "spec-plan", implement: "implement-spec", start: "start-specs", capability: "onboard-capability" };

export const SPEC_STEP_TEXT: Record<SpecStep, string> = { specify: "Specify", plan: "Design & tasks", implement: "Implement", start: "Survey the project", capability: "Write capability spec" };

/** The message Start specs begins with. For a new project the notes are the description to write the specs for. */
export function startRequest(specsRoot: string): string {
  return `Survey this repository: write the project file, ${specsRoot}/project.md, and propose its capabilities as a list to review, ${specsRoot}/onboarding.md.\n\nNotes (for a new project with little code, describe what it is for): `;
}

/** The message that writes one capability's spec; the survey's entry for it is composed into the run's context. */
export function capabilityRequest(entry: Pick<OnboardingEntry, "name" | "title">, specsRoot: string): string {
  return `Write the spec of the capability ${entry.title}, into ${specsRoot}/capabilities/${entry.name}/spec.md.\n\nNotes: `;
}

/** The message a run starts with; the person may add notes after it before sending. */
export function specRequest(step: SpecStep, change: { number: number | null; title: string; dir: string }, specsRoot: string): string {
  const number = change.number !== null ? `${String(change.number).padStart(4, "0")} ` : "";
  const folder = `${specsRoot}/changes/${change.dir}`;
  const what = step === "specify"
    ? `Write the spec of change ${number}${change.title}, into ${folder}/spec.md, and its quality checklist, checklist.md.`
    : step === "plan"
      ? `Write the design and the task list of change ${number}${change.title}, into ${folder}/design.md and tasks.md.`
      : `Implement change ${number}${change.title} from ${folder}: build the tasks of tasks.md that are not ticked yet, then verify every criterion of spec.md.`;
  return `${what}\n\nNotes: `;
}

interface WorkflowSpecMetadata {
  step?: string;
  outputs?: Record<string, string>;
}

/** The documents a finished run wrote: each step the workflow maps to a file, with its reply. */
export function specDocuments(definition: unknown, state: unknown): { name: string; text: string }[] {
  const metadata = (definition as { metadata?: { spec?: WorkflowSpecMetadata } } | null)?.metadata?.spec;
  const outputs = metadata?.outputs ?? {};
  return finishedAgentSteps(definition, state)
    .filter((step) => outputs[step.id] && step.output.trim())
    .map((step) => ({ name: outputs[step.id], text: step.output }));
}

function describe(recorded: SpecRecorded, step: SpecStep): string {
  if (step === "start" || step === "capability") return `Saved ${recorded.written.length} file${recorded.written.length === 1 ? "" : "s"}: ${recorded.written.join(", ")}.`;
  const files = recorded.written.map((path) => path.split("/").pop()).join(", ");
  const problems = recorded.warnings.filter((warning) => warning.severity !== "note").length;
  const check = problems ? ` ${problems} problem${problems === 1 ? "" : "s"} to look at on the Specs page.` : "";
  return `Saved ${files} in ${recorded.written[0]?.replace(/\/[^/]+$/, "") ?? "the change folder"}. Status: ${recorded.status}.${check}`;
}

interface StepState {
  status?: string;
  output?: unknown;
  checkpoint?: { completed?: unknown };
  attempts?: { checkpoint?: { completed?: unknown } }[];
}

const object = (value: unknown): Record<string, unknown> | undefined => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined);

/** The tasks the queue accepted: from the build step's checkpoint (also kept when the run failed or was stopped), else its output. */
function acceptedTasks(build: StepState | undefined): SpecProgress["tasks"] {
  const completed = build?.checkpoint?.completed ?? build?.attempts?.at(-1)?.checkpoint?.completed ?? object(build?.output)?.tasks;
  if (!Array.isArray(completed)) return [];
  return completed.flatMap((entry) => {
    const done = object(entry);
    if (!done || done.skipped === true || typeof done.task_id !== "string") return [];
    return [{ id: done.task_id, built: markdownText(done.build ?? ""), review: markdownText(done.review ?? "") }];
  });
}

/** Verify's report as the folder records it; none when the step did not finish. */
function verificationOf(verify: StepState | undefined): SpecVerification | null {
  const report = verify?.status === "succeeded" ? object(verify.output) : undefined;
  if (!report || !Array.isArray(report.criteria)) return null;
  return {
    summary: typeof report.summary === "string" ? report.summary : "",
    criteria: report.criteria.flatMap((entry) => {
      const criterion = object(entry);
      if (!criterion || typeof criterion.id !== "string") return [];
      return [{ id: criterion.id, status: String(criterion.status ?? ""), evidence: String(criterion.evidence ?? ""), how_to_test: String(criterion.how_to_test ?? "") }];
    }),
  };
}

/** What an Implement run got to, from the last workflow state; `passed` is whether the run finished. */
export function implementProgress(state: unknown, passed: boolean): SpecProgress {
  const steps = (object(state)?.steps ?? {}) as Record<string, StepState>;
  return { tasks: acceptedTasks(steps.build), verification: verificationOf(steps.verify), passed };
}

/** Writes an Implement run's progress into the change and says what happened, as a note. Quiet when there was nothing to record. */
export async function recordImplementRun(client: SpecsClient, run: SpecRun, state: unknown, passed: boolean, date: string): Promise<string> {
  const progress = implementProgress(state, passed);
  if (!progress.tasks.length && !progress.verification && !passed) return "";
  try {
    const recorded = await client.progress(run.root, run.change, progress, date);
    const ticked = recorded.ticked.length ? `Ticked ${recorded.ticked.join(", ")}. ` : "";
    return `\n\n_${ticked}Status: ${recorded.status}.${progress.verification ? " Verification is in verification.md." : ""}_`;
  } catch (failure) {
    const message = failure && typeof failure === "object" && "message" in failure ? String((failure as { message: unknown }).message) : String(failure);
    return `\n\n_The progress could not be saved to the change: ${message}_`;
  }
}

/** Writes a finished run's documents into the change and says what happened, as the note the reply ends with. */
export async function recordSpecRun(client: SpecsClient, run: SpecRun, definition: unknown, state: unknown, date: string): Promise<string> {
  const documents = specDocuments(definition, state);
  if (!documents.length) return "\n\n_The run produced no document, so nothing was saved to the spec._";
  try {
    return `\n\n_${describe(await client.record(run.root, run.change, run.step, documents, date), run.step)}_`;
  } catch (failure) {
    const message = failure && typeof failure === "object" && "message" in failure ? String((failure as { message: unknown }).message) : String(failure);
    return `\n\n_The result could not be saved to the change: ${message}_`;
  }
}
