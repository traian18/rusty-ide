/**
 * WorkflowApprovalCard — a question a running workflow step put to the user
 * (usually: approve this plan, ask for changes, or reject it). The run waits
 * until it is answered.
 */

import React, { useState } from "react";
import { UserCheck } from "lucide-react";
import { Button } from "../../ui";
import { MarkdownRenderer } from "../../ui/MarkdownRenderer";
import type { WorkflowAnswer, WorkflowQuestion } from "../../../harness/contract";
import { formatWorkflowOutput } from "../../../harness/core/workflowRun";
import { markdownText } from "../../../harness/core/markdownText";
import styles from "./WorkflowApprovalCard.module.css";

export interface WorkflowApprovalCardProps {
  question: WorkflowQuestion;
  onAnswer: (answer: WorkflowAnswer) => void;
}

const VARIANT: Record<string, "primary" | "secondary" | "danger"> = {
  approve: "primary",
  reject: "danger",
};

export const WorkflowApprovalCard: React.FC<WorkflowApprovalCardProps> = ({ question, onAnswer }) => {
  const [notes, setNotes] = useState("");
  // A list (e.g. the checks to try by hand) reads as one block per item.
  const subject = Array.isArray(question.subject)
    ? markdownText({ Details: question.subject })
    : formatWorkflowOutput(question.subject);
  const needsText = question.decisions.some((decision) => decision.requiresText);
  return (
    <section className={styles.card} aria-label={`${question.step} needs your answer`} data-testid="workflow-approval">
      <div className={styles.header}>
        <UserCheck size={14} aria-hidden />
        <span>{question.step} needs your answer</span>
      </div>
      <p className={styles.prompt}>{question.prompt}</p>
      {subject.trim() ? (
        <div className={styles.subject}>
          <MarkdownRenderer content={subject} />
        </div>
      ) : null}
      <textarea
        className={styles.notes}
        aria-label="Notes"
        placeholder={needsText ? "Notes, or the changes you want (needed to request changes)" : "Notes (optional)"}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
      <div className={styles.actions}>
        {question.decisions.map((decision) => (
          <Button
            key={decision.id}
            type="button"
            variant={VARIANT[decision.id] ?? "secondary"}
            disabled={decision.requiresText && !notes.trim()}
            title={decision.requiresText && !notes.trim() ? "Describe the changes first" : undefined}
            onClick={() => onAnswer({ decision: decision.id, ...(notes.trim() ? { text: notes.trim() } : {}) })}
          >
            {decision.label}
          </Button>
        ))}
        <span className={styles.hint}>The workflow waits for your answer.</span>
      </div>
    </section>
  );
};
