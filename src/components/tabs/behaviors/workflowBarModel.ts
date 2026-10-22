/**
 * What the Agent chat's workflow bar shows, derived from the chosen
 * workflow, its document and its latest run. Kept apart from the bar's
 * markup so a new run detail (a status, a retry rule, a policy) changes
 * this module, not the component.
 */

import type { WorkflowStepProgress, WorkflowStepStatus } from "../../../harness/core/workflowRun";
import { type JsonObject, type Position, layoutSteps, stepsOf } from "./behaviorModel";
import type { Choice } from "./ChoiceSelect";
import { AUTO_FLOW, workflowSwitchTargets } from "./flowCatalog";
import type { BuiltinWorkflowKind } from "./starterFlow";
import type { WorkflowResearchProgress, WorkflowRunView } from "./workflowRunStore";

export interface WorkflowChoice {
  path: string;
  name: string;
  /** A stage is a short run that stops at a handoff to review; the rest run a whole pipeline. */
  kind?: BuiltinWorkflowKind;
  description?: string;
  /** Short id (without the built-in namespace), what the router and `switch_to` refer to. */
  id?: string;
  /** When the router should pick it (`metadata.route.when`); absent means it is never auto-picked. */
  route?: string;
  /** Whether any step can change files. */
  edits?: boolean;
  /** Ids it may hand over to mid-run (`metadata.switch_to`). */
  switchTo?: string[];
}

/** The select value for running a single agent loop instead of a workflow. */
export const SINGLE = "";

/** Quiet time before the bar says a step has gone silent. */
export const IDLE_NOTICE_MS = 60_000;

export const STATUS_LABEL: Record<WorkflowStepStatus, string> = {
  running: "running",
  waiting: "waiting for permission",
  asking: "waiting for your answer",
  retry: "retrying",
  succeeded: "done",
  failed: "failed",
};

export const RESEARCH_LABEL: Record<WorkflowResearchProgress["status"], string> = {
  running: "running",
  done: "answered",
  failed: "failed",
};

/** Paused on the user (a permission or a question): not stuck, nothing to report. */
const PAUSED_STATUSES = new Set<WorkflowStepStatus>(["waiting", "asking"]);

export interface BarStep {
  id: string;
  name: string;
  position?: Position;
}

export interface ActiveStep extends BarStep {
  index: number;
}

export interface WorkflowBarInput {
  workflows: WorkflowChoice[];
  /** Path of the workflow this chat follows, or AUTO_FLOW. */
  selected?: string;
  definition?: JsonObject;
  run?: WorkflowRunView;
  running: boolean;
  autoAvailable: boolean;
  /** `orderedSteps(definition)`, memoized by the caller. */
  steps: BarStep[];
  now: number;
}

export interface WorkflowBarView {
  name: string;
  options: Choice[];
  /** The workflow declares others to hand over to (always so with Auto). */
  handsOver: boolean;
  /** Some step may ask for approval (always so with Auto). */
  hasApprovals: boolean;
  /** The run whose progress the step list shows, if any. */
  shownRun?: WorkflowRunView;
  activeStep?: ActiveStep;
  summary: string;
  collapsedSummary: string;
  quietMs: number;
  stallMs?: number;
}

export function formatQuiet(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function byCanvasPosition(a: BarStep, b: BarStep): number {
  return (a.position?.x ?? 0) - (b.position?.x ?? 0) || (a.position?.y ?? 0) - (b.position?.y ?? 0);
}

/** Steps in the order they run (left to right on the canvas). */
export function orderedSteps(definition: JsonObject | undefined): BarStep[] {
  if (!definition) return [];
  const positions = layoutSteps(definition);
  return stepsOf(definition)
    .map((step) => ({ id: String(step.id), name: String(step.name ?? step.id), position: positions.get(String(step.id)) }))
    .sort(byCanvasPosition);
}

function workflowDisplayName(selected: string | undefined, current: WorkflowChoice | undefined, definition: JsonObject | undefined): string {
  if (selected === AUTO_FLOW) {
    // With Auto, `definition` is the workflow Rusty chose for the latest message.
    const chosen = typeof definition?.name === "string" ? definition.name : undefined;
    return chosen ? `Auto · ${chosen}` : "Auto";
  }
  return current?.name ?? (selected ? selected.split("/").pop() ?? selected : "");
}

function workflowOption(workflow: WorkflowChoice): Choice {
  return { value: workflow.path, label: `${workflow.kind === "stage" ? "Stage" : "Workflow"}: ${workflow.name}` };
}

function modeOptions({ workflows, selected, autoAvailable }: WorkflowBarInput, current: WorkflowChoice | undefined, name: string): Choice[] {
  const offerAuto = autoAvailable || selected === AUTO_FLOW;
  const autoLabel = autoAvailable ? "Auto: choose a workflow for each message" : "Auto (needs OpenRouter and a JEV model)";
  const missing = selected && !current ? [{ value: selected, label: `Workflow: ${name} (missing)` }] : [];
  return [
    { value: SINGLE, label: "Single agent" },
    ...(offerAuto ? [{ value: AUTO_FLOW, label: autoLabel }] : []),
    ...workflows.map(workflowOption),
    ...missing,
  ];
}

function hasApprovalStep(definition: JsonObject | undefined): boolean {
  return stepsOf(definition ?? {}).some((step) => step.type === "approval");
}

/** The latest run shows while this chat runs it, and once it has finished. */
function showsRun({ selected, run, running }: WorkflowBarInput): boolean {
  if (!selected || !run) return false;
  return running || run.status !== "running";
}

function activeStepOf({ running, run, steps }: WorkflowBarInput): ActiveStep | undefined {
  if (!running || !run?.current) return undefined;
  const index = steps.findIndex((step) => step.id === run.current);
  return index >= 0 ? { ...steps[index], index } : undefined;
}

function stepSuffix(progress: WorkflowStepProgress | undefined): string {
  if (!progress) return "";
  if (PAUSED_STATUSES.has(progress.status)) return ` (${STATUS_LABEL[progress.status]})`;
  return progress.attempt > 1 ? ` (attempt ${progress.attempt})` : "";
}

function runSummary(running: boolean, stepCount: number, active: ActiveStep | undefined, progress: WorkflowStepProgress | undefined): string {
  if (!running) return "";
  if (!active) return "Starting the workflow…";
  return `Running step ${active.index + 1} of ${stepCount}: ${active.name}${stepSuffix(progress)}`;
}

function collapsedSummary(running: boolean, active: ActiveStep | undefined, name: string): string {
  if (running) return active ? `Running: ${active.name}` : "Workflow running…";
  return name || "Single agent";
}

/** How long the running step has been silent; a paused step is not counted. */
function quietTime({ running, run, now }: WorkflowBarInput, progress: WorkflowStepProgress | undefined): number {
  if (!running || !run) return 0;
  if (progress && PAUSED_STATUSES.has(progress.status)) return 0;
  return now - run.lastActivityAt;
}

/** The workflow's own stall timeout (`policies.stall_timeout_ms`), when set. */
function stallLimitMs(definition: JsonObject | undefined): number | undefined {
  const limit = (definition?.policies as { stall_timeout_ms?: unknown } | undefined)?.stall_timeout_ms;
  return typeof limit === "number" && limit > 0 ? limit : undefined;
}

export function workflowBarView(input: WorkflowBarInput): WorkflowBarView {
  const auto = input.selected === AUTO_FLOW;
  const current = auto ? undefined : input.workflows.find((workflow) => workflow.path === input.selected);
  const name = workflowDisplayName(input.selected, current, input.definition);
  const activeStep = activeStepOf(input);
  const progress = activeStep ? input.run?.steps[activeStep.id] : undefined;
  return {
    name,
    options: modeOptions(input, current, name),
    handsOver: auto || workflowSwitchTargets(input.definition).length > 0,
    // With Auto the workflow is chosen per message, so any of them may ask.
    hasApprovals: auto || hasApprovalStep(input.definition),
    shownRun: showsRun(input) ? input.run : undefined,
    activeStep,
    summary: runSummary(input.running, input.steps.length, activeStep, progress),
    collapsedSummary: collapsedSummary(input.running, activeStep, name),
    quietMs: quietTime(input, progress),
    stallMs: stallLimitMs(input.definition),
  };
}
