import { Issue, Json, JsonObject, Position, clone, isObject, positionOf, uniqueId, withPosition } from "./shared";

export const STEP_TYPES = ["input", "agent", "verify", "approval", "subflow", "output"] as const;

export type StepType = (typeof STEP_TYPES)[number];


export function workflowId(workflow: Json): string {
  return isObject(workflow) && typeof workflow.id === "string" ? workflow.id : "";
}


export function stepsOf(workflow: Json): JsonObject[] {
  return isObject(workflow) && Array.isArray(workflow.nodes) ? workflow.nodes.filter(isObject) : [];
}


export function edgesOf(workflow: Json): JsonObject[] {
  return isObject(workflow) && Array.isArray(workflow.edges) ? workflow.edges.filter(isObject) : [];
}


export function stepConfig(step: JsonObject): JsonObject {
  return isObject(step.config) ? step.config : {};
}


export function stepProfile(step: JsonObject): string | undefined {
  const profile = stepConfig(step).profile;
  return isObject(profile) && typeof profile.id === "string" ? profile.id : undefined;
}


/** Where an approval step sends requested changes: its `revise_target`, or
 * else the step that produced what it reviews. */
export function approvalReviseTarget(step: JsonObject): string | undefined {
  const config = stepConfig(step);
  if (typeof config.revise_target === "string" && config.revise_target) return config.revise_target;
  const subject = config.subject;
  return isObject(subject) && subject.type === "node_output" && typeof subject.node_id === "string" && subject.node_id
    ? subject.node_id
    : undefined;
}


/**
 * Lanes for the loops drawn below the cards (a step sending work back to an
 * earlier one), given each loop's horizontal span. The shortest loops run
 * closest to the cards; a loop runs one lane below every shorter loop it
 * overlaps, so nested loops never cross. Loops side by side share a lane.
 */
export function loopLanes(loops: Array<{ id: string; left: number; right: number }>): Map<string, number> {
  const placed: Array<{ left: number; right: number; lane: number }> = [];
  const lanes = new Map<string, number>();
  const byLength = [...loops].sort((a, b) => a.right - a.left - (b.right - b.left) || a.left - b.left);
  for (const loop of byLength) {
    const below = placed.filter((other) => other.left < loop.right && loop.left < other.right);
    const lane = below.length ? Math.max(...below.map((other) => other.lane)) + 1 : 0;
    placed.push({ left: loop.left, right: loop.right, lane });
    lanes.set(loop.id, lane);
  }
  return lanes;
}


export function defaultStepConfig(type: StepType, workflow: Json): JsonObject {
  switch (type) {
    case "input":
      return { defaults: {} };
    case "agent":
      return {
        instructions: "",
        tools: { type: "inherit" },
        context_mode: "isolated_child",
        structured_output: "text",
      };
    case "verify":
      return { checks: [{ type: "schema" }] };
    case "subflow":
      // One step run as a flow of its own; point it at a saved flow instead if one fits.
      return { target: { type: "step", instructions: "Gather what the next steps need." } };
    case "approval": {
      // Reviews the latest agent step's result; changes go back to it.
      const agent = [...stepsOf(workflow)].reverse().find((step) => step.type === "agent");
      return {
        subject: { type: "node_output", node_id: String(agent?.id ?? ""), pointer: "" },
        max_revisions: 5,
        allow_auto_approve: true,
      };
    }
    case "output": {
      const agent = stepsOf(workflow).find((step) => step.type === "agent");
      return {
        source: { type: "node_output", node_id: String(agent?.id ?? ""), pointer: "" },
        strict: true,
      };
    }
  }
}


export function addStep(workflow: JsonObject, type: StepType, position: Position): { workflow: JsonObject; id: string } {
  const id = uniqueId(stepsOf(workflow).map((step) => String(step.id)), type);
  const base: JsonObject = { id, name: type[0].toUpperCase() + type.slice(1), type, config: defaultStepConfig(type, workflow) };
  // Text is stored as a string internally; the model has no output schema.
  if (type === "agent") base.output_schema = { type: "inline", name: `${id}_output`, schema: DEFAULT_AGENT_OUTPUT };
  const step = withPosition(base, position);
  return { workflow: { ...workflow, nodes: [...stepsOf(workflow), step] }, id };
}


export function replaceStep(workflow: JsonObject, id: string, step: JsonObject): JsonObject {
  return { ...workflow, nodes: stepsOf(workflow).map((current) => (current.id === id ? step : current)) };
}


/** Removes a step together with every edge touching it. */
export function removeStep(workflow: JsonObject, id: string): JsonObject {
  return {
    ...workflow,
    nodes: stepsOf(workflow).filter((step) => step.id !== id).map((step) =>
      Array.isArray(step.input_bindings) ? { ...step, input_bindings: (step.input_bindings as JsonObject[]).filter((binding) => !isObject(binding.source) || binding.source.node_id !== id) } : step,
    ),
    edges: edgesOf(workflow).filter((edge) => edge.source !== id && edge.target !== id),
  };
}


export function connectSteps(
  workflow: JsonObject,
  source: string,
  target: string,
  condition: "on_success" | "on_failure" = "on_success",
): JsonObject {
  const edges = edgesOf(workflow);
  if (edges.some((edge) => edge.source === source && edge.target === target && edge.condition === condition)) {
    return workflow;
  }
  const id = uniqueId(edges.map((edge) => String(edge.id)), `${source}_to_${target}`);
  const nodes = stepsOf(workflow).map((step) => {
    if (step.id !== target || stepConfig(step).structured_output !== "text" || condition !== "on_success") return step;
    const bindings = Array.isArray(step.input_bindings) ? step.input_bindings as JsonObject[] : [];
    if (bindings.some((binding) => isObject(binding.source) && binding.source.node_id === source)) return step;
    return { ...step, input_bindings: [...bindings, { target: source, source: { type: "node_output", node_id: source, pointer: "" } }] };
  });
  return { ...workflow, nodes, edges: [...edges, { id, source, target, condition }] };
}


export function replaceEdge(workflow: JsonObject, id: string, edge: JsonObject): JsonObject {
  return { ...workflow, edges: edgesOf(workflow).map((current) => (current.id === id ? edge : current)) };
}


export function removeEdge(workflow: JsonObject, id: string): JsonObject {
  const edge = edgesOf(workflow).find((item) => item.id === id);
  const nodes = stepsOf(workflow).map((step) => {
    if (!edge || edge.condition !== "on_success" || step.id !== edge.target || !Array.isArray(step.input_bindings)) return step;
    return { ...step, input_bindings: (step.input_bindings as JsonObject[]).filter((binding) =>
      !(binding.target === edge.source && isObject(binding.source) && binding.source.node_id === edge.source && binding.source.pointer === ""),
    ) };
  });
  return { ...workflow, nodes, edges: edgesOf(workflow).filter((edge) => edge.id !== id) };
}


/** Left-to-right layout by distance from the input step, for unpositioned steps. */
export function layoutSteps(workflow: Json): Map<string, Position> {
  const steps = stepsOf(workflow);
  const edges = edgesOf(workflow).filter((edge) => edge.condition !== "on_failure");
  const depth = new Map<string, number>();
  const roots = steps.filter((step) => step.type === "input").map((step) => String(step.id));
  const queue = roots.length ? roots : steps.slice(0, 1).map((step) => String(step.id));
  queue.forEach((id) => depth.set(id, 0));
  while (queue.length) {
    const id = queue.shift()!;
    for (const edge of edges) {
      if (edge.source === id && !depth.has(String(edge.target))) {
        depth.set(String(edge.target), (depth.get(id) ?? 0) + 1);
        queue.push(String(edge.target));
      }
    }
  }
  const rows = new Map<number, number>();
  const positions = new Map<string, Position>();
  steps.forEach((step, index) => {
    const id = String(step.id);
    const column = depth.get(id) ?? index;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    positions.set(id, positionOf(step) ?? { x: 60 + column * 440, y: 80 + row * 260 });
  });
  return positions;
}


export const DEFAULT_AGENT_OUTPUT: JsonObject = {
  type: "string",
};


/** New workflows exchange ordinary written handoffs; JSON contracts remain opt-in. */
export function newWorkflow(id: string, template: JsonObject | undefined): JsonObject {
  const base = template ? clone(template) : { schema_version: 1, nodes: [], edges: [] };
  const schema = { type: "inline", name: "written_handoff", schema: DEFAULT_AGENT_OUTPUT };
  const lastAgent = [...stepsOf(base)].reverse().find((step) => step.type === "agent" || step.type === "verify");
  const source = { type: "node_output", node_id: String(lastAgent?.id ?? ""), pointer: "" };
  const nodes = stepsOf(base).map((step): JsonObject => {
    const { timeout_ms: _timeout, ...rest } = step;
    if (step.type === "agent" || step.type === "verify") return {
      ...rest, type: "agent", output_schema: schema, retry: { max_attempts: 1, retry_on: [] },
      config: {
        ...defaultStepConfig("agent", base),
        instructions: step.type === "verify"
          ? "Review the supplied handoff against the actual workspace and relevant checks. Report verified results, failures and remaining work in ordinary text. Do not edit files."
          : "Complete the user's request using the supplied context. Finish with a written handoff describing changes, checks and remaining work. Use ordinary text or Markdown.",
      },
    };
    if (step.type === "output") return { ...rest, config: { source, strict: false } };
    return rest;
  });
  // No output contract: the result is the output node's text.
  const { output_contract: _contract, ...rest } = base;
  return { ...rest, nodes, input_schema: null,
    policies: {}, id, revision: 1, name: id, status: "draft" };
}

/* ------------------------------------------------------------------ */
/*  Issues                                                             */
/* ------------------------------------------------------------------ */


/**
 * Issues at any of `prefixes` or below them, in the core compilers' path
 * notation (`rules[2]` matches `rules[2].do.inject`; `nodes.plan` matches
 * `nodes.plan.config`).
 */
export function issuesUnder(issues: Issue[], ...prefixes: string[]): Issue[] {
  return issues.filter((issue) =>
    prefixes.some(
      (prefix) =>
        issue.path === prefix || issue.path.startsWith(`${prefix}.`) || issue.path.startsWith(`${prefix}[`),
    ),
  );
}


/** Issues belonging to workflow step `index` (the core uses both forms). */
export function stepIssues(issues: Issue[], index: number, id: string): Issue[] {
  return issuesUnder(issues, `nodes[${index}]`, `nodes.${id}`);
}


/** Parses a list of tool names written one per line or comma-separated. */
export function parseNameList(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((name) => name.trim())
    .filter(Boolean);
}

