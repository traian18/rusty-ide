// ============================================================
// hostDefaults.ts — Builds a RunHost for a component or coordinator to
// pass to harness.run(), filling in requestPermission from the shared
// commandPermissionService (so every caller gets the same permission
// dialog for free) and defaulting readFile/writeFile/writePlan/
// askQuestion to a clear rejection for a capability that has no business
// needing them (e.g. inline_chat, which the sidecar never sends file or
// question RPC for) rather than silently hanging. Every prompt to the user
// goes through auto mode (autoMode.ts), which answers it while it is on.
// ============================================================

import { commandPermissionService } from "../services/commandPermissionService";
import { notificationCoordinator } from "../services/notificationRuntime";
import { AUTO_PERMISSION, autoQuestionAnswer, autoWorkflowAnswer, unlessAuto } from "./autoMode";
import type { RunHost } from "./contract";

export interface RunHostOptions {
  readFile?: RunHost["readFile"];
  writeFile?: RunHost["writeFile"];
  writePlan?: RunHost["writePlan"];
  askQuestion?: RunHost["askQuestion"];
  askWorkflowInput?: RunHost["askWorkflowInput"];
}

const askQuestionThroughNotifications: NonNullable<RunHost["askQuestion"]> = async (question, signal) => {
  const response = await notificationCoordinator.register({
    requestId: question.requestId,
    kind: "model_question",
    title: "Rusty needs your input",
    body: question.question,
    actions: [
      ...question.options.map((option, index) => ({ id: `option-${index}`, label: option.label, isDefault: index === 0 })),
      { id: "answer", label: "Send answer", input: { kind: "text", placeholder: "Type a response", maxLength: 4000, multiline: true } },
    ],
    createdAt: Date.now(),
    expiresAt: Date.now() + 15 * 60_000,
    signal,
  });
  if (response.actionId === "answer") {
    const answer = response.inputValue?.trim() ?? "";
    if (!answer) throw new Error("A question response cannot be empty");
    return answer.slice(0, 4000);
  }
  const action = question.options[Number(response.actionId.replace("option-", ""))];
  if (!action) throw new Error("Invalid question response");
  return action.label;
};

function unsupported(kind: string): () => Promise<never> {
  return () => Promise.reject(new Error(`This run has no ${kind} handler.`));
}

export function createRunHost(options: RunHostOptions = {}): RunHost {
  const askQuestion = options.askQuestion ?? askQuestionThroughNotifications;
  const askWorkflowInput = options.askWorkflowInput;
  return {
    readFile: options.readFile ?? unsupported("readFile"),
    writeFile: options.writeFile ?? unsupported("writeFile"),
    writePlan: options.writePlan,
    askQuestion: (question, signal) => unlessAuto(() => autoQuestionAnswer(question), (asking) => askQuestion(question, asking), signal),
    askWorkflowInput: askWorkflowInput
      ? (question, signal) => unlessAuto(() => autoWorkflowAnswer(question), (asking) => askWorkflowInput(question, asking), signal)
      : undefined,
    requestPermission: (request, signal) => unlessAuto(() => AUTO_PERMISSION, (asking) => commandPermissionService.request(request, asking), signal),
  };
}
