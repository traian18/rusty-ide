import { useState } from "react";
import { todosFor, type Todo } from "../../../harness/core/definitions/todoTool";
import type { WorkflowQuestion } from "../../../harness/contract";
import type { StepPlan } from "../../agent/stepPlans";
import type { SubagentActivity } from "../../ui/Chat";
import type { AgentQuestion } from "../../ui/ChatInput";
import type { TokenUsageLike } from "../../ui/TokenBadge/TokenBadge";
import { isActiveSubagent } from "./subagents";
import { DEFAULT_STREAMING_LABEL, type TurnUi } from "./turn";

/** What the tab shows of the run in progress: its status, plan, subagents,
 * usage, and what it asks of the user. */
export function useTurnUi(tabId: string) {
  const [message, setMessage] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [subagents, setSubagents] = useState<SubagentActivity[]>([]);
  const [runUsage, setRunUsage] = useState<TokenUsageLike | null>(null);
  const [streamingLabel, setStreamingLabel] = useState(DEFAULT_STREAMING_LABEL);
  const [agentQuestions, setAgentQuestions] = useState<AgentQuestion[]>([]);
  // Questions a running workflow step put to the user (approvals), oldest first.
  const [workflowQuestions, setWorkflowQuestions] = useState<WorkflowQuestion[]>([]);
  const [workflowRunning, setWorkflowRunning] = useState(false);
  const [plan, setPlan] = useState<Todo[]>(() => todosFor(tabId));
  // A workflow run's plans, one per step session.
  const [stepPlans, setStepPlans] = useState<StepPlan[]>([]);
  const hasActiveSubagents = subagents.some(isActiveSubagent);

  const ui: Omit<TurnUi, "setAutoWorkflow"> = {
    setSubagents, setAgentQuestions, setWorkflowQuestions, setRunUsage, setStreamingLabel,
    setIsStreaming, setWorkflowRunning, setPlan, setStepPlans, setMessage,
  };
  return {
    ui, message, isStreaming, subagents, runUsage, streamingLabel, agentQuestions, workflowQuestions, workflowRunning, plan, stepPlans,
    hasActiveSubagents, isAgentBusy: isStreaming || hasActiveSubagents,
  };
}
