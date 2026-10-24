import type { CommonEvent } from "../../../harness/contract";
import { scheduleTreeRefresh } from "../../filetree/FileTreePresenter";
import { useWorkflowRunStore } from "../behaviors/workflowRunStore";
import { mergeSubagent, readIncomingSubagent } from "./subagents";
import { scheduleResponseFlush, type AgentTurn } from "./turn";

/** What the tab tracks of one run while it goes. */
export interface RunProgress {
  /** The workflow step running now, which the status line names. */
  step?: string;
  /** Each workflow step's type, by node id. */
  stepTypes: Record<string, string>;
  /** Every file this run changed, whichever tool changed it. */
  changed: Set<string>;
}

type EventOf<K extends CommonEvent["kind"]> = Extract<CommonEvent, { kind: K }>;
type Handlers = { [K in CommonEvent["kind"]]: (turn: AgentTurn, run: RunProgress, event: EventOf<K>) => void };

/** Sets the status line, prefixed with the workflow step running. */
function setRunLabel(turn: AgentTurn, run: RunProgress, label: string) {
  turn.ui.setStreamingLabel(run.step ? `${run.step} · ${label}` : label);
}

function onLog(turn: AgentTurn, run: RunProgress, { message }: EventOf<"log">) {
  turn.activity.append(message, "tool");
  turn.activity.scheduleFlush();
  if (message.startsWith("Calling ")) setRunLabel(turn, run, message.replace(/\.\.\.$/, "…"));
  else if (message.includes("completed") || message.includes("failed")) setRunLabel(turn, run, "Processing results…");
}

function onResearch(turn: AgentTurn, run: RunProgress, event: EventOf<"workflow_research">) {
  useWorkflowRunStore.getState().research(event.workflowId, {
    callId: event.callId,
    nodeId: event.nodeId,
    question: event.question,
    status: event.status,
  });
  if (event.status === "running") {
    setRunLabel(turn, run, "Researching…");
    turn.activity.append(`↳ Research: ${event.question}`, "update");
  } else {
    turn.activity.append(event.status === "done" ? "↳ Research answered." : "↳ Research failed; the step goes on without it.", "update");
  }
  turn.activity.flush();
}

/** Each agent workflow step owns its own activity and response pair. */
function startAgentStep(turn: AgentTurn, event: EventOf<"workflow_step">, label: string) {
  const stepKey = `${event.workflowId}:${event.nodeId}:${event.attempt}`;
  const previous = turn.state.activeWorkflowAgentStep;
  if (previous && previous !== stepKey) {
    turn.state.responseStream?.startSegment();
    turn.activity.startMessage();
    turn.state.delegatedSubagentIds = new Set();
    turn.ui.setSubagents([]);
  }
  turn.state.activeWorkflowAgentStep = stepKey;
  turn.activity.report(`▶ ${label}`);
}

function onStep(turn: AgentTurn, run: RunProgress, event: EventOf<"workflow_step">) {
  useWorkflowRunStore.getState().step(event.workflowId, event);
  const name = event.name ?? event.nodeId;
  const label = `${name}${event.attempt > 1 ? ` (attempt ${event.attempt})` : ""}`;
  if (event.status === "running") {
    run.step = label;
    setRunLabel(turn, run, "Working…");
    if (run.stepTypes[event.nodeId] === "agent") startAgentStep(turn, event, label);
  } else if (event.status === "waiting") {
    setRunLabel(turn, run, "Waiting for your permission…");
  } else if (event.status === "failed") {
    turn.activity.report(`✗ ${name} failed${event.message ? `: ${event.message}` : ""}`);
  }
}

/** A new activity card starts once per newly delegated subagent; its later events stay in that card. */
function onSubagent(turn: AgentTurn, _run: RunProgress, event: EventOf<"subagent">) {
  const incoming = readIncomingSubagent(event.subagent);
  if (!incoming) return;
  const delegated = turn.state.delegatedSubagentIds;
  if (!delegated.has(incoming.id)) {
    if (delegated.size > 0) turn.activity.startMessage();
    delegated.add(incoming.id);
  }
  turn.ui.setSubagents((prev) => mergeSubagent(prev, incoming));
}

const handlers: Handlers = {
  command_output: (turn, _run, event) => {
    turn.activity.append(event.content, "tool");
    turn.activity.scheduleFlush();
  },
  command_complete: () => scheduleTreeRefresh(),
  files_changed: (turn, run, event) => {
    event.paths.forEach((changed) => run.changed.add(changed));
    turn.chat.setModifiedFiles([...turn.state.modifiedFiles, ...event.paths]);
    scheduleTreeRefresh();
  },
  log: onLog,
  usage: (turn, _run, event) => turn.ui.setRunUsage(event.usage),
  token: (turn, run, event) => {
    setRunLabel(turn, run, "Generating response…");
    turn.state.responseStream?.append(event.content, event.messageId);
    scheduleResponseFlush(turn.state);
  },
  plan: (turn, _run, event) => turn.ui.setPlan(event.todos),
  progress: (turn, _run, event) => turn.activity.report(event.content),
  workflow_checkpoint: (turn, _run, event) => {
    turn.state.lastWorkflowState = event.state;
    turn.chat.setWorkflowCheckpoint(event.state);
  },
  workflow_research: onResearch,
  workflow_boundary: (turn, run, event) => {
    if (event.status === "checking") setRunLabel(turn, run, "Checking whether to switch flows…");
  },
  workflow_step: onStep,
  subagent: onSubagent,
};

/** Shows one run's events in the tab as they arrive. */
export function runEventHandler(turn: AgentTurn, run: RunProgress) {
  return (event: CommonEvent) => {
    // Any host event is a sign of life for the workflow's "no activity" notice.
    useWorkflowRunStore.getState().touchRunning();
    (handlers[event.kind] as (turn: AgentTurn, run: RunProgress, event: CommonEvent) => void)(turn, run, event);
  };
}
