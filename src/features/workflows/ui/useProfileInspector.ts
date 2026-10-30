import { useEffect, useMemo, useState } from "react";
import { RULE_EVENTS, type ActionType, type Issue, type Json, type JsonObject, type RuleEvent, isObject, rulesOf } from "../model";
import { assign } from "./InspectorFields";

export interface ProfileInspectorProps {
  profile: JsonObject;
  readOnly: boolean;
  issues: Issue[];
  profileIds: string[];
  focusedRule?: number;
  isDefault: boolean;
  onChange: (profile: JsonObject) => void;
  onSetDefault: (on: boolean) => void;
}

export function useProfileInspector({ profile, issues, focusedRule, onChange }: Pick<ProfileInspectorProps, "profile" | "issues" | "focusedRule" | "onChange">) {
  const id = String(profile.id);
  const field = (name: string) => `profile-${id}-${name}`;
  const set = (key: string, value: Json | undefined) => onChange(assign(profile, key, value));
  const instructions = isObject(profile.instructions) ? profile.instructions : {};
  const tools = isObject(profile.tools) ? profile.tools : { type: "inherit" };
  const execution = isObject(profile.execution) ? profile.execution : {};
  const limits = isObject(profile.limits) ? profile.limits : {};
  const rules = rulesOf(profile);
  const [newEvent, setNewEvent] = useState<RuleEvent>("PreToolUse");
  const [newAction, setNewAction] = useState<ActionType>("inject");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (focusedRule !== undefined) setExpanded((current) => new Set(current).add(focusedRule));
  }, [focusedRule, id]);

  const grouped = useMemo(
    () =>
      RULE_EVENTS.map((event) => ({
        event,
        rules: rules.map((rule, index) => ({ rule, index })).filter(({ rule }) => rule.on === event),
      })),
    [rules],
  );
  const documentIssues = issues.filter((issue) => !issue.path.startsWith("rules["));


  return {
    id,
    field,
    set,
    instructions,
    tools,
    execution,
    limits,
    rules,
    newEvent,
    setNewEvent,
    newAction,
    setNewAction,
    expanded,
    setExpanded,
    grouped,
    documentIssues,
  };
}
