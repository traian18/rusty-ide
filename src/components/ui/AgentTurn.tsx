import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronRight, Loader2, Maximize2, Minimize2 } from "lucide-react";
import type { ActivityEntry, Message, SubagentActivity } from "./Chat";
import { SubagentActivityPanel } from "./SubagentActivityPanel";
import styles from "./AgentTurn.module.css";

/** A user message, or everything the agent produced in answer to one. */
export type TurnItem =
  | { type: "user"; message: Message }
  | { type: "turn"; id: string; messages: Message[] };

/** One row of a turn's process, in the order it happened. */
export type ProcessStep =
  | { type: "text"; key: string; message: Message; at: number }
  | { type: "entry"; key: string; entry: ActivityEntry; at: number };

/** How long the balloon takes to fold away once the answer is in. */
const COLLAPSE_MS = 360;

export function groupAgentTurns(messages: Message[]): TurnItem[] {
  const items: TurnItem[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      items.push({ type: "user", message });
      continue;
    }
    const last = items[items.length - 1];
    if (last?.type === "turn") last.messages.push(message);
    else items.push({ type: "turn", id: message.id, messages: [message] });
  }
  return items;
}

/** The message shown large once a turn is done: its last model message. */
export function turnAnswer(messages: Message[]): Message | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") return messages[index];
  }
  return undefined;
}

const timeOf = (timestamp: string) => {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? 0 : parsed;
};

/** Model text and activity entries merged into one timeline. Entries saved
 * without a time keep the time of the activity message they belong to. */
export function processTimeline(messages: Message[]): ProcessStep[] {
  const steps: ProcessStep[] = [];
  for (const message of messages) {
    const at = timeOf(message.timestamp);
    if (message.role !== "console") {
      if (message.content.trim()) steps.push({ type: "text", key: message.id, message, at });
      continue;
    }
    const entries: ActivityEntry[] = message.activityEntries?.length
      ? message.activityEntries
      : message.content.split("\n").filter((line) => line.trim()).map((line) => ({ content: line, kind: "tool" }));
    entries.forEach((entry, index) => steps.push({ type: "entry", key: `${message.id}:${index}`, entry, at: entry.at ?? at }));
  }
  // Stable: rows that share a time keep the order they were recorded in.
  return steps.sort((a, b) => a.at - b.at);
}

const isStepStart = (entry: ActivityEntry) => entry.kind === "update" && entry.content.startsWith("▶");

export function processSummary(steps: ProcessStep[]): string {
  const workflowSteps = steps.filter((step) => step.type === "entry" && isStepStart(step.entry)).length;
  const toolCalls = steps.filter((step) => step.type === "entry" && step.entry.kind === "tool" && step.entry.content.startsWith("Calling ")).length;
  const notes = steps.filter((step) => step.type === "text").length;
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const parts = [
    workflowSteps && plural(workflowSteps, "step"),
    toolCalls && plural(toolCalls, "tool call"),
    notes && plural(notes, "message"),
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : plural(steps.length, "update");
}

interface AgentTurnProps {
  messages: Message[];
  /** The turn is still being worked on: everything stays in the balloon, which stays open. */
  live: boolean;
  label: string;
  subagents: SubagentActivity[];
  /** A message that must be visible (a search finding, a jump target): opens the balloon when it is inside. */
  revealMessageId?: string;
  renderMessage: (message: Message, variant: "process" | "answer") => React.ReactNode;
}

export const AgentTurn: React.FC<AgentTurnProps> = ({ messages, live, label, subagents, revealMessageId, renderMessage }) => {
  const answer = live ? undefined : turnAnswer(messages);
  const process = useMemo(() => messages.filter((message) => message !== answer), [messages, answer]);
  const steps = useMemo(() => processTimeline(process), [process]);
  const hasProcess = steps.length > 0 || subagents.length > 0;

  // A finished turn shows only its answer; one that never produced an answer keeps its work in view.
  const [phase, setPhase] = useState<"open" | "closing" | "closed">(() => (live || !answer ? "open" : "closed"));
  const [enlarged, setEnlarged] = useState(false);
  const [revealAnswer, setRevealAnswer] = useState(false);
  const wasLiveRef = useRef(live);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = () => {
    setPhase("closing");
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setPhase("closed");
      setEnlarged(false);
    }, COLLAPSE_MS);
  };
  const open = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
    setPhase("open");
  };
  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  // The moment the answer is in: fold the work away and let the answer drift in.
  useEffect(() => {
    if (wasLiveRef.current && !live && answer) {
      setRevealAnswer(true);
      close();
    }
    if (live) open();
    wasLiveRef.current = live;
  }, [live, answer]);

  useEffect(() => {
    if (revealMessageId && process.some((message) => message.id === revealMessageId)) open();
  }, [revealMessageId, process]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const followsLatestRef = useRef(true);
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (scroller && live && followsLatestRef.current) scroller.scrollTop = scroller.scrollHeight;
  });
  const handleScroll = () => {
    const scroller = scrollRef.current;
    if (scroller) followsLatestRef.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 4;
  };

  const bodyId = `agent-turn-process-${messages[0]?.id ?? "turn"}`;
  const expanded = phase === "open";

  return (
    <div className={styles.turn} data-testid="agent-turn">
      {hasProcess && (
        <div className={`${styles.balloon} ${live ? styles.live : ""} ${phase === "closing" ? styles.closing : ""}`} data-testid="agent-turn-process">
          <div className={styles.header}>
            <button
              type="button"
              className={styles.toggle}
              aria-expanded={expanded}
              aria-controls={bodyId}
              onClick={() => (expanded ? close() : open())}
              data-testid="agent-turn-toggle"
            >
              <ChevronRight size={12} className={`${styles.chevron} ${expanded ? styles.chevronOpen : ""}`} aria-hidden="true" />
              {live ? (
                <Loader2 size={12} className={`animate-spin ${styles.statusIcon}`} aria-hidden="true" />
              ) : (
                <CheckCircle2 size={12} className={styles.doneIcon} aria-hidden="true" />
              )}
              <span className={styles.title}>{live ? label : "Worked through"}</span>
              <span className={styles.summary}>{processSummary(steps)}</span>
            </button>
            {expanded && (
              <button
                type="button"
                className={styles.enlarge}
                onClick={() => setEnlarged((value) => !value)}
                aria-label={enlarged ? "Shrink the process view" : "Enlarge the process view"}
                title={enlarged ? "Shrink" : "Enlarge"}
              >
                {enlarged ? <Minimize2 size={12} aria-hidden="true" /> : <Maximize2 size={12} aria-hidden="true" />}
              </button>
            )}
          </div>
          {phase !== "closed" && (
            <div id={bodyId} className={styles.body}>
              <div className={styles.clip}>
                <div
                  ref={scrollRef}
                  className={`${styles.scroller} ${enlarged ? styles.enlarged : ""}`}
                  onScroll={handleScroll}
                  tabIndex={0}
                  aria-label="Agent process"
                  data-testid="agent-activity-list"
                >
                  {steps.map((step) => step.type === "text" ? (
                    <div key={step.key} className={`${styles.row} ${styles.textRow}`}>{renderMessage(step.message, "process")}</div>
                  ) : (
                    <div
                      key={step.key}
                      className={`${styles.row} ${isStepStart(step.entry) ? styles.stepRow : step.entry.kind === "tool" ? styles.toolRow : styles.updateRow}`}
                      data-activity-kind={step.entry.kind}
                    >
                      {step.entry.content}
                    </div>
                  ))}
                  {subagents.length > 0 && <SubagentActivityPanel subagents={subagents} />}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {answer && (
        <div className={`${styles.answer} ${revealAnswer ? styles.reveal : ""}`} data-testid="agent-turn-answer">
          {renderMessage(answer, "answer")}
        </div>
      )}
    </div>
  );
};
