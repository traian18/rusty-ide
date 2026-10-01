/**
 * autoFlowSelection.ts -- what the Agent chat does with the router's answer
 * when its Mode is **Auto**.
 *
 * A confident pick that cannot change files just runs, and says what it chose.
 * A confident pick that can change files is put to the user first. An unsure
 * router puts its likeliest options to the user. A router that cannot answer
 * falls back to the single agent rather than blocking the message. Asking the
 * user, and announcing, are injected so this stays free of UI.
 */

import {
  routeMessage,
  SINGLE_AGENT_ID,
  type FlowOption,
  type FlowRouterDeps,
  type RankedFlow,
} from "./flowRouter";

/** A workflow the router may pick, and where to read it from. */
export interface FlowCandidate extends FlowOption {
  path: string;
}

export type FlowChoice =
  | { type: "single" }
  | { type: "workflow"; candidate: FlowCandidate }
  /** The user declined every offer: nothing should run. */
  | { type: "cancelled" };

export interface AskOption {
  label: string;
  description?: string;
}

export interface ChooseFlowArgs {
  message: string;
  lastResult?: string;
  lastRun?: { name: string; status: string };
  candidates: FlowCandidate[];
  router: FlowRouterDeps;
  /** Puts a question to the user and resolves to the chosen option's label (or free text). */
  ask: (question: string, options: AskOption[]) => Promise<string>;
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
  const byId = new Map<string, FlowOption & { path?: string }>([[SINGLE_AGENT_ID, SINGLE_AGENT_OPTION], ...candidates.map((candidate) => [candidate.id, candidate] as const)]);
  const toChoice = (id: string): FlowChoice => {
    const candidate = candidates.find((entry) => entry.id === id);
    return candidate ? { type: "workflow", candidate } : { type: "single" };
  };
  const route = await routeMessage(
    { message: args.message, lastResult: args.lastResult, lastRun: args.lastRun, options: [SINGLE_AGENT_OPTION, ...candidates] },
    args.router,
  );

  if (route.type === "unavailable") {
    announce(`↳ AUTO · Could not choose a workflow (${route.reason.replace(/\.$/, "")}); answering directly.`);
    return { type: "single" };
  }

  if (route.type === "run") {
    announce(`↳ AUTO · ${byId.get(route.id)?.name ?? route.id} (${percent(route.confidence)})`);
    return toChoice(route.id);
  }

  const labelOf = (id: string) => byId.get(id)?.name ?? id;
  const pick = (answer: string, labels: Map<string, string>): FlowChoice => {
    const id = labels.get(answer.trim());
    if (!id) return { type: "cancelled" };
    announce(`↳ AUTO · ${labelOf(id)} (you chose)`);
    return toChoice(id);
  };

  if (route.type === "confirm") {
    const chosen = byId.get(route.id)!;
    const alternative = route.ranked.find((entry) => entry.id !== route.id && entry.id !== SINGLE_AGENT_ID && byId.get(entry.id)?.edits === false);
    const labels = new Map<string, string>([[`Run ${chosen.name}`, route.id], [SINGLE_AGENT_NAME, SINGLE_AGENT_ID]]);
    const options: AskOption[] = [
      { label: `Run ${chosen.name}`, description: `${chosen.criterion} It can change files.` },
      { label: SINGLE_AGENT_NAME, description: "Answer directly, without a workflow." },
    ];
    if (alternative) {
      const entry = byId.get(alternative.id)!;
      labels.set(entry.name, alternative.id);
      options.push({ label: entry.name, description: entry.criterion });
    }
    return pick(await args.ask(`Auto suggests "${chosen.name}" (${percent(route.confidence)}). It can change files. Run it?`, options), labels);
  }

  // The router could not decide: put the likeliest options to the user.
  const ranked: RankedFlow[] = route.ranked.filter((entry) => byId.has(entry.id));
  if (!ranked.some((entry) => entry.id === SINGLE_AGENT_ID)) ranked.push({ id: SINGLE_AGENT_ID, probability: 0 });
  const labels = new Map(ranked.map((entry) => [labelOf(entry.id), entry.id] as const));
  const options: AskOption[] = ranked.map((entry) => ({ label: labelOf(entry.id), description: byId.get(entry.id)?.criterion }));
  return pick(await args.ask("Which workflow should handle this?", options), labels);
}
