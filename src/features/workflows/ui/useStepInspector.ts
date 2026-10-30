import type { WorkflowInspectorProps } from "./WorkflowInspector";
import { type Json, type JsonObject, edgesOf, isObject, replaceStep, stepConfig, stepProfile, stepsOf } from "../model";
import { assign } from "./InspectorFields";

export function useStepInspector(props: WorkflowInspectorProps & { step: JsonObject; index: number }) {
  const { workflow, step, index, issues, profileIds, flowIds = [], onChange, onSelect, onDrill } = props;
  const stepId = String(step.id);
  const field = (name: string) => `step-${stepId}-${name}`;
  const type = String(step.type);
  const config = stepConfig(step);
  const update = (next: JsonObject) => onChange(replaceStep(workflow, stepId, next));
  const setConfig = (key: string, value: Json | undefined) => update({ ...step, config: assign(config, key, value) });
  const tools = isObject(config.tools) ? config.tools : { type: "none" };
  const profile = stepProfile(step);
  const otherSteps = stepsOf(workflow).filter((candidate) => candidate.id !== stepId);
  // Which other steps' records the step sees: "own" (omitted), "all", or {steps: [...]}.
  const access = config.context_access;
  const accessMode = access === "all" ? "all" : isObject(access) ? "steps" : "own";
  const accessSteps = isObject(access) && Array.isArray(access.steps) ? access.steps.filter((id): id is string => typeof id === "string") : [];
  const upstream = new Set<string>();
  const pending = [stepId];
  while (pending.length) {
    const target = pending.pop();
    for (const edge of edgesOf(workflow)) {
      const source = String(edge.source);
      if (edge.target === target && edge.condition === "on_success" && !upstream.has(source)) {
        upstream.add(source);
        pending.push(source);
      }
    }
  }


  return {
    stepId, field, type, config,
    update, setConfig, tools, profile,
    otherSteps, access, accessMode, accessSteps,
    upstream, pending, workflow, step,
    index, issues, profileIds, flowIds,
    onChange, onSelect, onDrill,
  };
}

export type StepInspectorModel = ReturnType<typeof useStepInspector>;
