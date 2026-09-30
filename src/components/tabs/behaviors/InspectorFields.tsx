/** Small building blocks shared by the profile and workflow inspectors. */

import React, { useEffect, useState } from "react";
import { Field, Textarea } from "../../ui";
import { type Issue, type Json, type JsonObject } from "./behaviorModel";
import styles from "./Behaviors.module.css";

/** `object` with `key` set, or removed when `value` is undefined or "". */
export function assign(object: JsonObject, key: string, value: Json | undefined): JsonObject {
  const next = { ...object };
  if (value === undefined || value === "") delete next[key];
  else next[key] = value;
  return next;
}

export function optionalNumber(text: string): number | undefined {
  if (text.trim() === "") return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * A JSON value edited as text. Invalid text stays local (with an error)
 * until it parses; `optional` treats empty text as "remove the field".
 */
export const JsonField: React.FC<{
  id: string;
  label: string;
  value: Json | undefined;
  onChange: (value: Json | undefined) => void;
  hint?: string;
  optional?: boolean;
  tall?: boolean;
  readOnly?: boolean;
}> = ({ id, label, value, onChange, hint, optional = false, tall = false, readOnly = false }) => {
  const external = value === undefined ? "" : JSON.stringify(value, null, 2);
  const [text, setText] = useState(external);
  const [error, setError] = useState<string>();

  // Follow outside changes (another field, undo, a different selection)
  // unless the local text already means the same value.
  useEffect(() => {
    setText((current) => {
      try {
        if (current.trim() === "" ? external === "" : JSON.stringify(JSON.parse(current), null, 2) === external) {
          return current;
        }
      } catch {
        // Local text is invalid; the outside value wins.
      }
      return external;
    });
    setError(undefined);
  }, [external]);

  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <Textarea
        id={id}
        className={`${styles.code} ${tall ? styles.codeTall : ""}`}
        value={text}
        spellCheck={false}
        readOnly={readOnly}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          if (optional && next.trim() === "") {
            setError(undefined);
            onChange(undefined);
            return;
          }
          try {
            const parsed = JSON.parse(next) as Json;
            setError(undefined);
            onChange(parsed);
          } catch (parseError) {
            setError((parseError as Error).message);
          }
        }}
      />
    </Field>
  );
};

export const IssueList: React.FC<{ issues: Issue[] }> = ({ issues }) =>
  issues.length === 0 ? null : (
    <ul className={styles.issues}>
      {issues.map((issue, index) => (
        <li key={`${issue.path}-${issue.code}-${index}`} className={`${styles.issue} ${issue.blocking ? "" : styles.warning}`}>
          {issue.message}
          {issue.path ? <span className={styles.issuePath}> · {issue.path}</span> : null}
        </li>
      ))}
    </ul>
  );
