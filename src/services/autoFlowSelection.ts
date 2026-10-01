/**
 * autoFlowSelection.ts -- what the Agent chat does with the router's answer
 * when its Mode is **Auto**.
 *
 * Auto decides on its own and never asks. A confident pick runs and the chat
 * says what it chose (and that it can change files, when it can). When no
 * workflow fits clearly, or the router cannot answer, the single agent answers:
 * it sees the whole conversation and works under the skill the user picked.
 * Announcing is injected so this stays free of UI.
 */

import {
  routeMessage,
  SINGLE_AGENT_ID,
  type FlowOption,
  type FlowRouterDeps,
} from "./flowRouter";

/** A workflow the router may pick, and where to read it from. */
export interface FlowCandidate extends FlowOption {
  path: string;
}

export type FlowChoice =
  | { type: "single" }
  | { type: "workflow"; candidate: FlowCandidate };

export interface ChooseFlowArgs {
  message: string;
  /** What the user asked earlier in the conversation, oldest first. */
  recentRequests?: string[];
  lastResult?: string;
  lastRun?: { name: string; status: string };
  candidates: FlowCandidate[];
  router: FlowRouterDeps;
  announce: (line: string) => void;
}

export const SINGLE_AGENT_NAME = "Single agent";
const SINGLE_AGENT_OPTION: FlowOption = {
  id: SINGLE_AGENT_ID,
  name: SINGLE_AGENT_NAME,
  criterion:
    "A quick question, an explanation, a small tweak or a conversational message that needs neither a multi-step investigation nor a plan: a factual question, explaining a snippet, a one-line change.",
  edits: false,
};

const percent = (confidence: number) => `${Math.round(confidence * 100)}% confidence`;

export async function chooseFlow(args: ChooseFlowArgs): Promise<FlowChoice> {
  const { candidates, announce } = args;
  const route = await routeMessage(
    {
      message: args.message,
      recentRequests: args.recentRequests,
      lastResult: args.lastResult,
      lastRun: args.lastRun,
      options: [SINGLE_AGENT_OPTION, ...candidates],
    },
    args.router,
  );

  if (route.type === "unavailable") {
    announce(`↳ AUTO · Could not choose a workflow (${route.reason.replace(/\.$/, "")}); answering directly.`);
    return { type: "single" };
  }

  if (route.type === "undecided") {
    announce(`↳ AUTO · ${SINGLE_AGENT_NAME} (no workflow was a clear fit)`);
    return { type: "single" };
  }

  const candidate = candidates.find((entry) => entry.id === route.id);
  if (!candidate) {
    announce(`↳ AUTO · ${SINGLE_AGENT_NAME} (${percent(route.confidence)})`);
    return { type: "single" };
  }
  announce(`↳ AUTO · ${candidate.name} (${percent(route.confidence)})${candidate.edits ? " · can change files" : ""}`);
  return { type: "workflow", candidate };
}
