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

export const STEP_TYPES = ["input", "agent", "verify", "output"] as const;
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
        // The step's JSON is validated by the harness, never constrained
        // natively: a native schema rides on every request of a tool-using
        // step, and some models (Gemini) reject that combination.
        structured_output: "host_validated",
      };
    case "verify":
      return { checks: [{ type: "schema" }] };
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
  // Agent steps must declare what they return; start with a summary.
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
    nodes: stepsOf(workflow).filter((step) => step.id !== id),
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
  return { ...workflow, edges: [...edges, { id, source, target, condition }] };
}

export function replaceEdge(workflow: JsonObject, id: string, edge: JsonObject): JsonObject {
  return { ...workflow, edges: edgesOf(workflow).map((current) => (current.id === id ? edge : current)) };
}

export function removeEdge(workflow: JsonObject, id: string): JsonObject {
  return { ...workflow, edges: edgesOf(workflow).filter((edge) => edge.id !== id) };
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
    positions.set(id, positionOf(step) ?? { x: 60 + column * 320, y: 80 + row * 220 });
  });
  return positions;
}

export const DEFAULT_AGENT_OUTPUT: JsonObject = {
  type: "object",
  required: ["summary"],
  properties: { summary: { type: "string" } },
};

/**
 * A new workflow from `template` (the built-in default). Its agent steps are
 * switched to host-validated JSON output: the default asks for the
 * provider's native structured output, which host-routed providers lack and
 * which models that cannot combine tools with a constrained response reject.
 */
export function newWorkflow(id: string, template: JsonObject | undefined): JsonObject {
  const base = template ? clone(template) : { schema_version: 1, nodes: [], edges: [] };
  const nodes = stepsOf(base).map((step) =>
    step.type === "agent" ? { ...step, config: { ...stepConfig(step), structured_output: "host_validated" } } : step,
  );
  return { ...base, nodes, id, revision: 1, name: id, status: "draft" };
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
