import React from "react";
import { EVENT_HELP } from "./eventHelp";
import { RuleCard } from "./RuleCard";
import { Plus } from "lucide-react";
import { Button, Callout, Field, Input, Textarea } from "../../../lib/ui";
import { Select } from "./ChoiceSelect";
import { ACTION_TYPES, RULE_EVENTS, type ActionType, type RuleEvent, addRule, isObject, issuesUnder, newRule, removeRule, replaceRule } from "../model";
import { IssueList, assign, optionalNumber } from "./InspectorFields";
import styles from "./Behaviors.module.css";
import { ToolSelector } from "./ToolSelector";
import { ToolOverrides, CompletionGateFields } from "./ProfileConfigFields";
import { useProfileInspector, type ProfileInspectorProps } from "./useProfileInspector";

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
  const model = useProfileInspector({ profile, issues, focusedRule, onChange });
  const { id, field, set, instructions, tools, execution, limits, rules, newEvent, setNewEvent, newAction, setNewAction, expanded, setExpanded, grouped, documentIssues } = model;
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
          <ToolSelector value={Array.isArray(tools.tools) ? tools.tools.filter((tool): tool is string => typeof tool === "string") : []}
            onChange={(selected) => set("tools", { type: "allow_list", tools: selected })} />
        ) : null}
        <ToolOverrides value={profile.tool_overrides} onChange={(value) => set("tool_overrides", value)} />
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
              placeholder="No profile limit"
              onChange={(e) => set("limits", assign(limits, "max_turns", optionalNumber(e.target.value)))}
            />
          </Field>
          <Field id={field("max-tools")} label="Max tool calls">
            <Input
              id={field("max-tools")}
              type="number"
              min={1}
              value={limits.max_tool_calls === undefined ? "" : String(limits.max_tool_calls)}
              placeholder="No profile limit"
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
          continues, up to the configured number of additional attempts.
        </p>
        <CompletionGateFields value={profile.completion_gate} profileIds={profileIds} onChange={(value) => set("completion_gate", value)} />
      </fieldset>

      <fieldset className={styles.section} disabled={readOnly}>
        <div className={styles.sectionTitle}>Child agents</div>
        <p className={styles.muted}>Child agents inherit this profile. Other child policies are not supported by the current engine.</p>
        {isObject(profile.children) && profile.children.type !== "inherit" ? (
          <Callout variant="warning">This saved child policy is unsupported. It is preserved until you change it.
            <Button onClick={() => set("children", { type: "inherit" })}>Use inherited settings</Button>
          </Callout>
        ) : null}
      </fieldset>
    </>
  );
};



