/**
 * behaviorModel.ts — pure document helpers for the Behaviors canvas.
 *
 * The canvas edits two kinds of rusty-core JSON document:
 * - behavior profiles (`.rusty/profiles/<id>.json`, schema
 *   `behavior-profile-v1`), drawn as nodes with `switch_profile` rules as
 *   edges between them;
 * - orchestration workflows (`.rusty/workflows/<id>.json`), drawn as a step
 *   graph whose agent steps drill into their profile.
 *
 * Documents are kept as plain JSON so fields this editor does not know about
 * survive a load/save round trip. Canvas positions live in
 * `metadata.editor.position`, which rusty-core ignores.
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export interface Position {
  x: number;
  y: number;
}

/** One validation problem, as returned by `behavior_validate_*`. */
export interface Issue {
  path: string;
  code: string;
  message: string;
  blocking: boolean;
}

export const RULE_EVENTS = [
  "RunStart",
  "BeforeModelRequest",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "ProfileEntered",
] as const;
export type RuleEvent = (typeof RULE_EVENTS)[number];

export const ACTION_TYPES = [
  "inject",
  "deny",
  "ask",
  "allow",
  "stop_run",
  "switch_profile",
  "rewrite_args",
  "rewrite_result",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** Events an action may run on, mirroring the core compiler's checks. */
export const ACTION_EVENTS: Record<ActionType, readonly RuleEvent[]> = {
  inject: RULE_EVENTS,
  deny: ["PreToolUse"],
  ask: ["PreToolUse"],
  allow: ["PreToolUse"],
  stop_run: RULE_EVENTS,
  switch_profile: RULE_EVENTS.filter((event) => event !== "ProfileEntered"),
  rewrite_args: ["PreToolUse"],
  rewrite_result: ["PostToolUse", "PostToolUseFailure"],
};

export const STEP_TYPES = ["input", "agent", "verify", "approval", "subflow", "output"] as const;
export type StepType = (typeof STEP_TYPES)[number];

export const BUILTIN_PREFIX = "rusty.";

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/* ------------------------------------------------------------------ */
/*  Positions                                                          */
/* ------------------------------------------------------------------ */

export function positionOf(item: Json | undefined): Position | undefined {
  if (!isObject(item) || !isObject(item.metadata)) return undefined;
  const editor = item.metadata.editor;
  if (!isObject(editor) || !isObject(editor.position)) return undefined;
  const { x, y } = editor.position;
  return typeof x === "number" && typeof y === "number" ? { x, y } : undefined;
}

export function withPosition<T extends JsonObject>(item: T, position: Position): T {
  const next = clone(item);
  const metadata = isObject(next.metadata) ? next.metadata : {};
  const editor = isObject(metadata.editor) ? metadata.editor : {};
  editor.position = { x: Math.round(position.x), y: Math.round(position.y) };
  metadata.editor = editor;
  (next as JsonObject).metadata = metadata;
  return next;
}

/** Grid slot for the `index`th item without a stored position. */
export function gridPosition(index: number, columns = 3): Position {
  return { x: 60 + (index % columns) * 340, y: 60 + Math.floor(index / columns) * 240 };
}

/** The room a node needs on the canvas: its own size plus a margin to see edges and labels. */
export const NODE_SLOT = { width: 340, height: 250 };

/** Least horizontal distance between two connected steps in a row, so an edge and its label stay visible. */
export const MIN_COLUMN_GAP = 400;

const overlaps = (a: Position, b: Position) => Math.abs(a.x - b.x) < NODE_SLOT.width - 40 && Math.abs(a.y - b.y) < NODE_SLOT.height - 40;

/**
 * Positions with no node on top of another, in the order given: a node that
 * would cover one placed before it moves to the nearest free slot. Nodes that
 * do not collide keep exactly the position they have.
 */
export function separateOverlaps(entries: Array<[string, Position]>): Map<string, Position> {
  const placed: Position[] = [];
  const result = new Map<string, Position>();
  const offsets: Array<[number, number]> = [];
  for (let dx = -4; dx <= 4; dx += 1) for (let dy = -4; dy <= 4; dy += 1) if (dx || dy) offsets.push([dx, dy]);
  offsets.sort((a, b) => a[0] ** 2 + a[1] ** 2 - (b[0] ** 2 + b[1] ** 2) || a[1] - b[1] || a[0] - b[0]);
  for (const [id, wanted] of entries) {
    let position = wanted;
    if (placed.some((other) => overlaps(position, other))) {
      const free = offsets
        .map(([dx, dy]) => ({ x: wanted.x + dx * NODE_SLOT.width, y: wanted.y + dy * NODE_SLOT.height }))
        .find((candidate) => candidate.x >= 0 && candidate.y >= 0 && !placed.some((other) => overlaps(candidate, other)));
      if (free) position = free;
    }
    placed.push(position);
    result.set(id, position);
  }
  return result;
}

/**
 * Stretches the layout sideways when connected steps in the same row sit
 * closer than [`MIN_COLUMN_GAP`], as in workflows saved with the old tight
 * spacing, so every edge has room to be seen. A layout that is already
 * roomy is returned as it is.
 */
export function spreadColumns(positions: Map<string, Position>, edges: JsonObject[]): Map<string, Position> {
  let tightest = Infinity;
  for (const edge of edges) {
    const from = positions.get(String(edge.source));
    const to = positions.get(String(edge.target));
    if (!from || !to || Math.abs(from.y - to.y) >= NODE_SLOT.height / 2) continue;
    const gap = Math.abs(to.x - from.x);
    if (gap > 0) tightest = Math.min(tightest, gap);
  }
  if (!Number.isFinite(tightest) || tightest >= MIN_COLUMN_GAP) return positions;
  const factor = Math.min(2, MIN_COLUMN_GAP / tightest);
  const left = Math.min(...[...positions.values()].map((position) => position.x));
  return new Map([...positions].map(([id, position]) => [id, { x: Math.round(left + (position.x - left) * factor), y: position.y }]));
}

/* ------------------------------------------------------------------ */
/*  Profiles                                                           */
/* ------------------------------------------------------------------ */

export function profileId(profile: Json): string {
  return isObject(profile) && typeof profile.id === "string" ? profile.id : "";
}

export function isBuiltin(id: string): boolean {
  return id.startsWith(BUILTIN_PREFIX);
}

export function rulesOf(profile: Json): JsonObject[] {
  return isObject(profile) && Array.isArray(profile.rules) ? profile.rules.filter(isObject) : [];
}

/** The action key of a rule's `do` (`inject`, `deny`, …). */
export function actionType(rule: JsonObject): ActionType | undefined {
  const action = rule.do;
  if (!isObject(action)) return undefined;
  const key = Object.keys(action)[0];
  return (ACTION_TYPES as readonly string[]).includes(key) ? (key as ActionType) : undefined;
}

export function switchTarget(rule: JsonObject): string | undefined {
  const action = rule.do;
  if (!isObject(action) || !isObject(action.switch_profile)) return undefined;
  const reference = action.switch_profile.profile;
  return isObject(reference) && typeof reference.id === "string" ? reference.id : undefined;
}

export interface SwitchEdge {
  id: string;
  source: string;
  target: string;
  ruleIndex: number;
  label: string;
}

/** `switch_profile` rules as edges; targets outside `known` are dropped. */
export function switchEdges(profiles: Json[]): SwitchEdge[] {
  const known = new Set(profiles.map(profileId));
  return profiles.flatMap((profile) => {
    const source = profileId(profile);
    return rulesOf(profile).flatMap((rule, ruleIndex) => {
      const target = switchTarget(rule);
      if (!target || !known.has(target)) return [];
      return [
        {
          id: `${source}::${ruleIndex}`,
          source,
          target,
          ruleIndex,
          label: `${String(rule.on ?? "?")} · ${String(rule.id ?? "")}`,
        },
      ];
    });
  });
}

export function newProfile(id: string, name = id): JsonObject {
  return {
    schema_version: 1,
    id,
    revision: 1,
    name,
    status: "draft",
    instructions: { mode: "append", text: "" },
    rules: [],
  };
}

/** A fresh action object for `type`, with placeholder values. */
export function defaultAction(type: ActionType, target = ""): JsonObject {
  switch (type) {
    case "inject":
      return { inject: { text: "" } };
    case "deny":
      return { deny: { reason: "" } };
    case "ask":
      return { ask: {} };
    case "allow":
      return { allow: {} };
    case "stop_run":
      return { stop_run: { reason: "" } };
    case "switch_profile":
      return { switch_profile: { profile: { id: target } } };
    case "rewrite_args":
      return { rewrite_args: { merge: {} } };
    case "rewrite_result":
      return { rewrite_result: { append: "" } };
  }
}

/** A rule id not already used in `profile`. */
export function uniqueRuleId(profile: Json, base: string): string {
  const used = new Set(rulesOf(profile).map((rule) => String(rule.id)));
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

export function newRule(profile: Json, on: RuleEvent, type: ActionType): JsonObject {
  const event = ACTION_EVENTS[type].includes(on) ? on : ACTION_EVENTS[type][0];
  const rule: JsonObject = { id: uniqueRuleId(profile, type.replace("_", "-")), on: event, do: defaultAction(type) };
  if (event === "PreToolUse" || event === "PostToolUse" || event === "PostToolUseFailure") {
    rule.when = { tool: "*" };
  }
  return rule;
}

export function addRule(profile: JsonObject, rule: JsonObject): JsonObject {
  return { ...profile, rules: [...rulesOf(profile), rule] };
}

export function replaceRule(profile: JsonObject, index: number, rule: JsonObject): JsonObject {
  const rules = rulesOf(profile).slice();
  rules[index] = rule;
  return { ...profile, rules };
}

export function removeRule(profile: JsonObject, index: number): JsonObject {
  return { ...profile, rules: rulesOf(profile).filter((_, at) => at !== index) };
}

/**
 * The rule a canvas connection `source → target` adds: switch after a few
 * turns. The condition is a placeholder the user is expected to edit.
 */
export function connectProfiles(profile: JsonObject, target: string): { profile: JsonObject; ruleIndex: number } {
  const rule: JsonObject = {
    id: uniqueRuleId(profile, `switch-to-${target}`),
    on: "BeforeModelRequest",
    when: { turn: { gte: 3 } },
    do: defaultAction("switch_profile", target),
    max_fires: 1,
  };
  const next = addRule(profile, rule);
  return { profile: next, ruleIndex: rulesOf(next).length - 1 };
}

/* ------------------------------------------------------------------ */
/*  Workflows                                                          */
/* ------------------------------------------------------------------ */

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

function uniqueId(used: Iterable<string>, base: string): string {
  const taken = new Set(used);
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
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

export function stableStringify(document: Json): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
