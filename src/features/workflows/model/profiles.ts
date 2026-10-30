import { Json, JsonObject, isObject } from "./shared";

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


export const BUILTIN_PREFIX = "rusty.";


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

