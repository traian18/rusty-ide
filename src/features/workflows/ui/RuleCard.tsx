import React, { useEffect } from "react";
import { ActionFields } from "./ActionFields";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { Field, IconButton, Input } from "../../../lib/ui";
import { Select } from "./ChoiceSelect";
import { ACTION_EVENTS, ACTION_TYPES, RULE_EVENTS, type ActionType, type Issue, type JsonObject, type RuleEvent, actionType, defaultAction, isObject } from "../model";
import { IssueList, assign, optionalNumber } from "./InspectorFields";
import styles from "./Behaviors.module.css";
import { ConditionEditor } from "./ConditionEditor";

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

export const RuleCard: React.FC<RuleCardProps> = ({
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
          <ConditionEditor label="When this rule applies" optional value={rule.when} profileIds={profileIds}
            onChange={(value) => onChange(assign(rule, "when", value))} />
          <ActionFields
            type={type}
            body={body}
            event={event}
            field={field}
            profileIds={profileIds.filter((candidate) => candidate !== profileId)}
            onChange={setBody}
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
