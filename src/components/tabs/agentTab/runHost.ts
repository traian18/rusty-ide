import { invoke } from "@tauri-apps/api/core";
import type { WorkflowAnswer, WorkflowQuestion } from "../../../harness/contract";
import { createRunHost } from "../../../harness/hostDefaults";
import { notify } from "../../../notificationStore";
import type { AgentQuestion } from "../../ui/ChatInput";
import type { AgentTurn } from "./turn";

/** A run's question to the user, answered from the chat box. */
function askQuestion(turn: AgentTurn, question: AgentQuestion): Promise<string> {
  return new Promise<string>((resolve) => {
    turn.state.questionResolvers.set(question.requestId, resolve);
    turn.ui.setAgentQuestions((prev) => prev.some((q) => q.requestId === question.requestId) ? prev : [...prev, question]);
  });
}

/** A workflow step's question (an approval), answered from its card; withdrawn when the workflow stops. */
function askWorkflowInput(turn: AgentTurn, question: WorkflowQuestion, signal: AbortSignal): Promise<WorkflowAnswer> {
  return new Promise<WorkflowAnswer>((resolve, reject) => {
    const forget = () => {
      turn.state.workflowAnswers.delete(question.requestId);
      turn.ui.setWorkflowQuestions((prev) => prev.filter((q) => q.requestId !== question.requestId));
    };
    signal.addEventListener("abort", () => {
      forget();
      reject(new DOMException("The workflow stopped", "AbortError"));
    }, { once: true });
    turn.state.workflowAnswers.set(question.requestId, (answer) => {
      forget();
      resolve(answer);
    });
    turn.ui.setWorkflowQuestions((prev) => prev.some((q) => q.requestId === question.requestId) ? prev : [...prev, question]);
    notify(`${question.step} needs your answer`, question.prompt, "info");
  });
}

/** The host the Agent tab's runs call back into: the disk, and the user. */
export function agentRunHost(turn: AgentTurn) {
  return createRunHost({
    readFile: (path) => invoke<string>("read_file_disk", { path }),
    writeFile: async (path, content) => {
      await invoke("write_file_disk", { path, content });
    },
    askQuestion: (question) => askQuestion(turn, question),
    askWorkflowInput: (question, signal) => askWorkflowInput(turn, question, signal),
  });
}
