/**
 * Inspector for one behavior profile: identity, instructions, tools, model
 * overlay, limits, rules grouped by the event they run on, and the
 * completion gate. Anything without a dedicated control is still reachable
 * through the raw JSON section.
 */

import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Button, Callout, Field, IconButton, Input, Textarea } from "../../ui";
import { Select } from "./ChoiceSelect";
import {
  ACTION_EVENTS,
  ACTION_TYPES,
  RULE_EVENTS,
  type ActionType,
  type Issue,
  type Json,
  type JsonObject,
  type RuleEvent,
  actionType,
  addRule,
  defaultAction,
  isObject,
  issuesUnder,
  newRule,
  parseNameList,
  removeRule,
  replaceRule,
  rulesOf,
} from "./behaviorModel";
import { IssueList, JsonField, assign, optionalNumber } from "./InspectorFields";
import styles from "./Behaviors.module.css";

const EVENT_HELP: Record<RuleEvent, string> = {
  RunStart: "once, when a run starts",
  BeforeModelRequest: "before every model request",
  PreToolUse: "before a tool runs — can deny, ask, allow or rewrite arguments",
  PostToolUse: "after a tool succeeds — can inject or rewrite the result",
  PostToolUseFailure: "after a tool fails",
  ProfileEntered: "when a switch lands on this profile",
};

const CONDITION_HINT =
  'e.g. {"tool": "fs.edit"}, {"turn": {"gte": 3}}, {"calls": {"tool": "shell.*", "gte": 2}}, ' +
  '{"arg": {"pointer": "/path", "glob": "*.env"}}, {"all": [...]}, {"not": {...}}. Empty = always.';

const GATE_TEMPLATE: JsonObject = {
  checks: [
    {
      id: "tests-ran",
      // "Not (edited, then ran nothing)": also passes runs that never edit.
      require: { not: { since_last_call: { of: ["fs.edit", "fs.write"], called: "shell.exec", eq: 0 } } },
      feedback: "You edited files but did not run the tests afterwards. Run them before finishing.",
    },
  ],
  max_continuations: 2,
  on_exhausted: "fail",
};

interface ProfileInspectorProps {
  profile: JsonObject;
  readOnly: boolean;
  issues: Issue[];
  profileIds: string[];
  focusedRule?: number;
  isDefault: boolean;
  onChange: (profile: JsonObject) => void;
  onSetDefault: (on: boolean) => void;
}

export const ProfileInspector: React.FC<ProfileInspectorProps> = ({
  profile,
  readOnly,
  issues,
  profileIds,
  focusedRule,
  isDefault,
  onChange,
  onSetDefault,
}) => {
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

  return (
    <>
      {readOnly ? (
        <div className={styles.section}>
          <Callout variant="info">
            Built-in profiles are read-only. Create a workspace profile and switch to it, or make it the
            workspace default.
          </Callout>
        </div>
      ) : null}
      {documentIssues.length ? (
        <div className={styles.section}>
          <IssueList issues={documentIssues} />
        </div>
      ) : null}

      <fieldset className={styles.section} disabled={readOnly}>
        <div className={styles.sectionTitle}>Profile</div>
        <Field id={field("name")} label="Name">
          <Input id={field("name")} value={String(profile.name ?? "")} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field id={field("description")} label="Description">
          <Input
            id={field("description")}
            value={String(profile.description ?? "")}
            onChange={(e) => set("description", e.target.value)}
          />
        </Field>
        <div className={styles.row}>
          <Field id={field("revision")} label="Revision">
            <Input
              id={field("revision")}
              type="number"
              min={1}
              value={String(profile.revision ?? 1)}
              onChange={(e) => set("revision", optionalNumber(e.target.value) ?? 1)}
            />
          </Field>
          <Field id={field("status")} label="Status">
            <Select
              id={field("status")}
              value={String(profile.status ?? "published")}
              onChange={(e) => set("status", e.target.value)}
              options={[
                { value: "draft", label: "Draft" },
                { value: "published", label: "Published" },
                { value: "deprecated", label: "Deprecated" },
              ]}
            />
          </Field>
        </div>
        <p className={styles.muted}>
          Sessions only load published profiles by default; drafts are reachable through switches and
          validation.
        </p>
        <div className={styles.inlineActions}>
          <Button type="button" variant={isDefault ? "primary" : "secondary"} onClick={() => onSetDefault(!isDefault)}>
            {isDefault ? "Workspace default ✓" : "Make workspace default"}
          </Button>
        </div>
      </fieldset>

      <fieldset className={styles.section} disabled={readOnly}>
        <div className={styles.sectionTitle}>Instructions</div>
        <Field id={field("instructions-mode")} label="Mode">
          <Select
            id={field("instructions-mode")}
            value={String(instructions.mode ?? "append")}
            onChange={(e) => set("instructions", { ...instructions, mode: e.target.value })}
            options={[
              { value: "append", label: "Append to the system prompt" },
              { value: "replace", label: "Replace the system prompt" },
            ]}
          />
        </Field>
        <Field id={field("instructions-text")} label="Text">
          <Textarea
            id={field("instructions-text")}
            rows={6}
            value={String(instructions.text ?? "")}
            onChange={(e) => set("instructions", { ...instructions, text: e.target.value })}
          />
        </Field>
      </fieldset>

      <fieldset className={styles.section} disabled={readOnly}>
        <div className={styles.sectionTitle}>Tools</div>
        <Field id={field("tools")} label="Available tools">
          <Select
            id={field("tools")}
            value={String(tools.type ?? "inherit")}
            onChange={(e) =>
              set("tools", e.target.value === "allow_list" ? { type: "allow_list", tools: [] } : { type: e.target.value })
            }
            options={[
              { value: "inherit", label: "Everything the session has" },
              { value: "allow_list", label: "Only these tools" },
              { value: "none", label: "No tools" },
            ]}
          />
        </Field>
        {tools.type === "allow_list" ? (
          <Field id={field("allow")} label="Allowed tools" hint="One name or glob per line, e.g. fs.read or mcp.github.*">
            <Textarea
              id={field("allow")}
              rows={4}
              className={styles.mono}
              value={Array.isArray(tools.tools) ? tools.tools.join("\n") : ""}
              onChange={(e) => set("tools", { type: "allow_list", tools: parseNameList(e.target.value) })}
            />
          </Field>
        ) : null}
        <JsonField
          id={field("overrides")}
          label="Tool overrides"
          hint='Per tool: {"shell.exec": {"permission": "ask", "description_append": "…"}}'
          optional
          value={profile.tool_overrides}
          onChange={(value) => set("tool_overrides", value)}
          readOnly={readOnly}
        />
      </fieldset>

      <fieldset className={styles.section} disabled={readOnly}>
        <div className={styles.sectionTitle}>Model and limits</div>
        <div className={styles.row}>
          <Field id={field("model")} label="Model">
            <Input
              id={field("model")}
              placeholder="session model"
              value={String(execution.model ?? "")}
              onChange={(e) => set("execution", assign(execution, "model", e.target.value))}
            />
          </Field>
          <Field id={field("effort")} label="Reasoning effort">
            <Select
              id={field("effort")}
              value={String(execution.reasoning_effort ?? "")}
              onChange={(e) => set("execution", assign(execution, "reasoning_effort", e.target.value))}
              options={[
                { value: "", label: "Session default" },
                { value: "low", label: "Low" },
                { value: "medium", label: "Medium" },
                { value: "high", label: "High" },
              ]}
            />
          </Field>
          <Field id={field("max-turns")} label="Max turns">
            <Input
              id={field("max-turns")}
              type="number"
              min={1}
              value={limits.max_turns === undefined ? "" : String(limits.max_turns)}
              onChange={(e) => set("limits", assign(limits, "max_turns", optionalNumber(e.target.value)))}
            />
          </Field>
          <Field id={field("max-tools")} label="Max tool calls">
            <Input
              id={field("max-tools")}
              type="number"
              min={1}
              value={limits.max_tool_calls === undefined ? "" : String(limits.max_tool_calls)}
              onChange={(e) => set("limits", assign(limits, "max_tool_calls", optionalNumber(e.target.value)))}
            />
          </Field>
        </div>
        <Field id={field("final")} label="Final turn prompt" hint="Sent on the last allowed turn.">
          <Input
            id={field("final")}
            value={String(limits.final_turn_prompt ?? "")}
            onChange={(e) => set("limits", assign(limits, "final_turn_prompt", e.target.value))}
          />
        </Field>
      </fieldset>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          <span>Rules</span>
          <span>{rules.length}</span>
        </div>
        {grouped.map(({ event, rules: eventRules }) =>
          eventRules.length === 0 ? null : (
            <div key={event} className={styles.eventGroup}>
              <div className={styles.eventName}>
                {event} <span className={styles.muted}>— {EVENT_HELP[event]}</span>
              </div>
              {eventRules.map(({ rule, index }) => (
                <RuleCard
                  key={index}
                  rule={rule}
                  index={index}
                  profileId={id}
                  readOnly={readOnly}
                  issues={issuesUnder(issues, `rules[${index}]`)}
                  profileIds={profileIds}
                  focused={focusedRule === index}
                  expanded={expanded.has(index)}
                  onToggle={() =>
                    setExpanded((current) => {
                      const next = new Set(current);
                      if (next.has(index)) next.delete(index);
                      else next.add(index);
                      return next;
                    })
                  }
                  onChange={(next) => onChange(replaceRule(profile, index, next))}
                  onRemove={() => {
                    setExpanded(new Set());
                    onChange(removeRule(profile, index));
                  }}
                />
              ))}
            </div>
          ),
        )}
        {rules.length === 0 ? <p className={styles.muted}>No rules: the profile only shapes the prompt and tools.</p> : null}
        {readOnly ? null : (
          <div className={styles.row}>
            <Select
              aria-label="Event for the new rule"
              value={newEvent}
              onChange={(e) => setNewEvent(e.target.value as RuleEvent)}
              options={RULE_EVENTS.map((event) => ({ value: event, label: event }))}
            />
            <Select
              aria-label="Action for the new rule"
              value={newAction}
              onChange={(e) => setNewAction(e.target.value as ActionType)}
              options={ACTION_TYPES.map((type) => ({ value: type, label: type }))}
            />
            <Button
              type="button"
              icon={<Plus size={14} />}
              onClick={() => {
                const rule = newRule(profile, newEvent, newAction);
                onChange(addRule(profile, rule));
                setExpanded((current) => new Set(current).add(rules.length));
              }}
            >
              Add rule
            </Button>
          </div>
        )}
      </div>

      <fieldset className={styles.section} disabled={readOnly}>
        <div className={styles.sectionTitle}>Completion gate</div>
        <p className={styles.muted}>
          Checks run when the model says it is done. A failed check sends its message back and the run
          continues, up to max_continuations times.
        </p>
        {profile.completion_gate === undefined && !readOnly ? (
          <div className={styles.inlineActions}>
            <Button type="button" icon={<Plus size={14} />} onClick={() => set("completion_gate", GATE_TEMPLATE)}>
              Add completion gate
            </Button>
          </div>
        ) : (
          <JsonField
            id={field("gate")}
            label="Gate"
            optional
            value={profile.completion_gate}
            onChange={(value) => set("completion_gate", value)}
            hint='Checks use "require" (a condition) or "evaluator": {"type": "tool" | "model" | "agent" | "command", …}. Empty removes the gate.'
            readOnly={readOnly}
          />
        )}
      </fieldset>

      <fieldset className={styles.section} disabled={readOnly}>
        <div className={styles.sectionTitle}>Child agents</div>
        <JsonField
          id={field("children")}
          label="Child policy"
          optional
          hint='{"type": "inherit"} (default), {"type": "named", "profile": {"id": "…"}}, or {"type": "derived", "overrides": {…}}'
          value={profile.children}
          onChange={(value) => set("children", value)}
          readOnly={readOnly}
        />
      </fieldset>
    </>
  );
};

interface RuleCardProps {
  rule: JsonObject;
  index: number;
  profileId: string;
  readOnly: boolean;
  issues: Issue[];
  profileIds: string[];
  focused: boolean;
  expanded: boolean;
  onToggle: () => void;
  onChange: (rule: JsonObject) => void;
  onRemove: () => void;
}

const RuleCard: React.FC<RuleCardProps> = ({
  rule,
  index,
  profileId,
  readOnly,
  issues,
  profileIds,
  focused,
  expanded,
  onToggle,
  onChange,
  onRemove,
}) => {
  const field = (name: string) => `rule-${profileId}-${index}-${name}`;
  const type = actionType(rule);
  const action = isObject(rule.do) && type ? rule.do[type] : undefined;
  const body = isObject(action) ? action : {};
  const setBody = (next: JsonObject) => type && onChange({ ...rule, do: { [type]: next } });
  const event = String(rule.on) as RuleEvent;
  const allowedEvents = type ? ACTION_EVENTS[type] : RULE_EVENTS;
  const cardRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focused) cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focused]);

  return (
    <div
      ref={cardRef}
      className={`${styles.rule} ${focused ? styles.ruleFocused : ""} ${issues.length ? styles.ruleInvalid : ""}`}
    >
      <button type="button" className={styles.ruleHeader} onClick={onToggle} aria-expanded={expanded}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className={styles.ruleId}>{String(rule.id)}</span>
        <span className={styles.chip}>{type ?? "?"}</span>
        {rule.when !== undefined ? <span className={styles.chip}>when</span> : null}
      </button>
      {expanded ? (
        <fieldset className={styles.eventGroup} disabled={readOnly}>
          <IssueList issues={issues} />
          <div className={styles.row}>
            <Field id={field("id")} label="Rule id">
              <Input id={field("id")} value={String(rule.id)} onChange={(e) => onChange({ ...rule, id: e.target.value })} />
            </Field>
            <Field id={field("fires")} label="Max fires">
              <Input
                id={field("fires")}
                type="number"
                min={1}
                placeholder="unlimited"
                value={rule.max_fires === undefined ? "" : String(rule.max_fires)}
                onChange={(e) => onChange(assign(rule, "max_fires", optionalNumber(e.target.value)))}
              />
            </Field>
            <Field id={field("on")} label="Runs on">
              <Select
                id={field("on")}
                value={event}
                onChange={(e) => onChange({ ...rule, on: e.target.value })}
                options={RULE_EVENTS.map((name) => ({
                  value: name,
                  label: allowedEvents.includes(name) ? name : `${name} (not for ${type})`,
                }))}
              />
            </Field>
            <Field id={field("do")} label="Action">
              <Select
                id={field("do")}
                value={type ?? ""}
                onChange={(e) => onChange({ ...rule, do: defaultAction(e.target.value as ActionType) })}
                options={ACTION_TYPES.map((name) => ({ value: name, label: name }))}
              />
            </Field>
          </div>
          <JsonField
            id={field("when")}
            label="When"
            optional
            hint={CONDITION_HINT}
            value={rule.when}
            onChange={(value) => onChange(assign(rule, "when", value))}
            readOnly={readOnly}
          />
          <ActionFields
            type={type}
            body={body}
            event={event}
            field={field}
            profileIds={profileIds.filter((candidate) => candidate !== profileId)}
            onChange={setBody}
            readOnly={readOnly}
          />
          {readOnly ? null : (
            <div className={styles.inlineActions}>
              <IconButton icon={<Trash2 size={14} />} label="Delete rule" size="sm" onClick={onRemove} />
            </div>
          )}
        </fieldset>
      ) : null}
    </div>
  );
};

const ActionFields: React.FC<{
  type: ActionType | undefined;
  body: JsonObject;
  event: RuleEvent;
  field: (name: string) => string;
  profileIds: string[];
  readOnly: boolean;
  onChange: (body: JsonObject) => void;
}> = ({ type, body, event, field, profileIds, readOnly, onChange }) => {
  const text = (key: string, label: string, hint?: string, rows = 3) => (
    <Field id={field(key)} label={label} hint={hint}>
      <Textarea id={field(key)} rows={rows} value={String(body[key] ?? "")} onChange={(e) => onChange(assign(body, key, e.target.value))} />
    </Field>
  );
  switch (type) {
    case "inject": {
      const tool = event === "PreToolUse" || event === "PostToolUse" || event === "PostToolUseFailure";
      return (
        <>
          {text("text", "Inject text", "Added to the model's context when the rule fires.", 4)}
          <Field id={field("placement")} label="Placement">
            <Select
              id={field("placement")}
              value={String(body.placement ?? "")}
              onChange={(e) => onChange(assign(body, "placement", e.target.value))}
              options={[
                { value: "", label: tool ? "Default (with the tool result)" : "Default (next request)" },
                ...(tool ? [{ value: "with_result", label: "With the tool result" }] : []),
                { value: "next_request", label: "Next request only" },
                ...(event === "RunStart" ? [{ value: "persistent", label: "Persistent (whole run)" }] : []),
              ]}
            />
          </Field>
        </>
      );
    }
    case "deny":
      return text("reason", "Reason", "Shown to the model instead of the tool result.");
    case "stop_run":
      return text("reason", "Reason", "The run ends with this message.");
    case "ask":
      return text("reason", "Reason (optional)", "Shown in the permission prompt.");
    case "allow":
      return <p className={styles.muted}>Runs the tool without asking, even if its permission is "ask".</p>;
    case "switch_profile": {
      const reference = isObject(body.profile) ? body.profile : {};
      const current = String(reference.id ?? "");
      const options = profileIds.includes(current) || !current ? profileIds : [current, ...profileIds];
      return (
        <Field id={field("target")} label="Switch to" hint="Applies before the next model request; the model is told.">
          <Select
            id={field("target")}
            value={current}
            onChange={(e) => onChange({ profile: { id: e.target.value } })}
            options={[{ value: "", label: "Choose a profile…" }, ...options.map((id) => ({ value: id, label: id }))]}
          />
        </Field>
      );
    }
    case "rewrite_args":
      return (
        <JsonField
          id={field("merge")}
          label="Merge into arguments"
          hint="RFC 7396 merge patch: null removes a key. What the user approves is the rewritten call."
          value={body.merge}
          onChange={(value) => onChange({ merge: value ?? {} })}
          readOnly={readOnly}
        />
      );
    case "rewrite_result": {
      const mode = body.replace !== undefined ? "replace" : "append";
      return (
        <>
          <Field id={field("mode")} label="Rewrite">
            <Select
              id={field("mode")}
              value={mode}
              onChange={(e) => onChange({ [e.target.value]: String(body[mode] ?? "") })}
              options={[
                { value: "append", label: "Append to the result" },
                { value: "replace", label: "Replace the result" },
              ]}
            />
          </Field>
          {text(mode, mode === "replace" ? "Replacement" : "Appended text")}
        </>
      );
    }
    default:
      return <p className={styles.muted}>Unknown action — edit it in the raw JSON section.</p>;
  }
};
