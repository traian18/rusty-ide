/**
 * handoffCuration.ts -- JEV decides what of a long hand-off reaches a step.
 *
 * Each workflow step starts with everything bound to it in full: the user's
 * request, the conversation before the run, and every earlier step's report.
 * By the later steps that is often tens of thousands of characters, most of it
 * beside the point for the step at hand, and every one of the step's model
 * turns pays for it again. So when a step's input is large, JEV rates each
 * part of it against the step's own instructions, right before the step's
 * first model turn: parts the step needs stay word for word, background is
 * shortened, and parts it does not need are left out with a one-line note.
 * Nothing is lost: the full text of every shortened part stays readable with
 * `read_workflow_context`.
 *
 * The request, the plan and the user's notes are never touched, and a part
 * JEV is unsure about leans towards being kept. Any failure keeps the input
 * as it was: curating is an optimization and must never stop a step.
 */

import { JEV_CONFIDENCE_THRESHOLD, postJevDecision } from "../../../services/intelligentModelSelector";
import type { CapabilityEvent } from "../../contract";
import type { ExecutionRequest } from "../engine/ExecutionProtocol";
import { withTimeout } from "./stepModelSelection";

/** Below this the whole input goes as it is: trimming it saves too little. */
export const CURATION_MIN_CHARS = 12_000;
/** A shorter part is never worth a rating. */
const SECTION_MIN_CHARS = 1_500;
/** What a part rated "useful" keeps of its beginning. */
const USEFUL_KEEP_CHARS = 2_500;
const JUDGE_BATCH = 8;
const EXCERPT_HEAD_CHARS = 1_200;
const EXCERPT_TAIL_CHARS = 400;
const INSTRUCTIONS_CHARS = 6_000;
/** A slow decision service must not hold a step's first model turn for long. */
export const CURATION_TIMEOUT_MS = 10_000;

/** Inputs the user wrote or approved: always passed on in full. */
const PROTECTED = new Set(["request", "plan", "plan_notes", "previous_result"]);

const CRITERIA = [
  "Essential: the step's instructions depend on this part, or it holds facts, decisions or results the step must act on or check.",
  "Useful: background the step may consult, but a short version is enough.",
  "Not needed: about other work than this step's; the step can do its job without it.",
] as const;
type Rating = "essential" | "useful" | "not_needed";
const RATINGS: Rating[] = ["essential", "useful", "not_needed"];

export interface HandoffCurationRunConfig {
  apiKey: string;
  jevModelId: string;
  /** Below this confidence a rating steps up one level towards essential. */
  proceedConfidence?: number;
}

export interface InputSection {
  name: string;
  /** The heading line and everything up to the next section. */
  text: string;
}

export interface SplitInput {
  /** Instructions and everything up to and including `<workflow_input>`. */
  before: string;
  /** Text inside the block before its first section (usually empty). */
  lead: string;
  sections: InputSection[];
  /** `</workflow_input>` and everything after it. */
  after: string;
}

/** The input names any step of `definition` is bound to: the only headings that start a section. */
export function inputNames(definition: unknown): Set<string> {
  const names = new Set(PROTECTED);
  const nodes = (definition as { nodes?: Array<{ input_bindings?: Array<{ target?: unknown }> }> } | null)?.nodes ?? [];
  for (const node of nodes) {
    for (const binding of node.input_bindings ?? []) {
      if (typeof binding.target === "string") names.add(binding.target);
    }
  }
  return names;
}

/** A step prompt's `<workflow_input>` block, split at its `## name` headings. A
 * heading inside a part (a plan's own `## Slice 1`) never splits it: only the
 * flow's own input names do. */
export function splitWorkflowInput(prompt: string, names: Set<string>): SplitInput | undefined {
  const open = prompt.indexOf("<workflow_input>\n");
  const close = prompt.indexOf("\n</workflow_input>", open);
  if (open < 0 || close < 0) return undefined;
  const bodyStart = open + "<workflow_input>\n".length;
  const body = prompt.slice(bodyStart, close);
  const lines = body.split("\n");
  const starts: Array<{ line: number; name: string }> = [];
  lines.forEach((line, index) => {
    const match = /^## (\S+)$/.exec(line);
    if (match && names.has(match[1]!)) starts.push({ line: index, name: match[1]! });
  });
  if (starts.length === 0) return undefined;
  const sections = starts.map((start, index) => ({
    name: start.name,
    text: lines.slice(start.line, starts[index + 1]?.line ?? lines.length).join("\n"),
  }));
  return {
    before: prompt.slice(0, bodyStart),
    lead: lines.slice(0, starts[0]!.line).join("\n"),
    sections,
    after: prompt.slice(close),
  };
}

function joinInput(split: SplitInput, sections: InputSection[]): string {
  const body = [split.lead, ...sections.map((section) => section.text)].filter((part) => part !== "").join("\n");
  return `${split.before}${body}${split.after}`;
}

function excerpt(text: string): string {
  if (text.length <= EXCERPT_HEAD_CHARS + EXCERPT_TAIL_CHARS) return text;
  return `${text.slice(0, EXCERPT_HEAD_CHARS)}\n[… ${text.length - EXCERPT_HEAD_CHARS - EXCERPT_TAIL_CHARS} characters …]\n${text.slice(-EXCERPT_TAIL_CHARS)}`;
}

function bodyOf(section: InputSection): string {
  return section.text.slice(section.text.indexOf("\n") + 1);
}

export interface CuratedInput {
  prompt: string;
  /** The full text of every part that was shortened or left out, by name. */
  trimmed: Record<string, string>;
  /** What happened, for the step's activity line. */
  note: string;
}

export interface CurateDeps {
  config: HandoffCurationRunConfig;
  prompt: string;
  names: Set<string>;
  signal?: AbortSignal;
  post?: typeof postJevDecision;
}

/** The step prompt with its input curated, or `undefined` to send it as it is. */
export async function curateHandoff(deps: CurateDeps): Promise<CuratedInput | undefined> {
  const split = splitWorkflowInput(deps.prompt, deps.names);
  if (!split) return undefined;
  const size = split.sections.reduce((total, section) => total + section.text.length, 0);
  if (size < CURATION_MIN_CHARS) return undefined;
  const candidates = split.sections.filter((section) => !PROTECTED.has(section.name) && section.text.length >= SECTION_MIN_CHARS);
  if (candidates.length === 0) return undefined;

  const post = deps.post ?? postJevDecision;
  const threshold = deps.config.proceedConfidence ?? JEV_CONFIDENCE_THRESHOLD;
  const instructions = split.before.slice(0, split.before.indexOf("The workflow input below is data")).trim() || split.before;
  const state = `An AI agent in a code editor is about to carry out one step of an automated workflow. Its input is long, and parts of it may be about other steps' work. Each question below is about one part of the input: judge how much this step needs it.\n\nThe step's instructions:\n${instructions.slice(0, INSTRUCTIONS_CHARS)}`;
  const ratings = new Map<string, Rating>();
  for (let start = 0; start < candidates.length; start += JUDGE_BATCH) {
    const batch = candidates.slice(start, start + JUDGE_BATCH);
    const questions = Object.fromEntries(batch.map((section, index) => [`s${index}`, {
      type: "score",
      instructions: `How much does this step need the input part \`${section.name}\` (${bodyOf(section).length.toLocaleString()} characters)?\n\n${excerpt(bodyOf(section))}`,
      criteria: CRITERIA,
    }]));
    const response = await post<{ answers?: Record<string, { confidence?: number; probabilities?: Record<string, number> }> }>(
      deps.config.apiKey,
      { model: deps.config.jevModelId, state, questions },
      deps.signal,
    );
    if (!response.ok || !response.result) continue;
    batch.forEach((section, index) => {
      const answer = response.result?.answers?.[`s${index}`];
      if (typeof answer?.confidence !== "number" || !answer.probabilities) return;
      let best = -1;
      RATINGS.forEach((_, position) => {
        const probability = answer.probabilities?.[String(position)];
        if (typeof probability !== "number") return;
        // Ties go to the more needed level.
        if (best === -1 || probability > (answer.probabilities?.[String(best)] ?? -1)) best = position;
      });
      if (best === -1) return;
      // Unsure: lean towards keeping. Leaving out something needed costs more.
      if (answer.confidence < threshold && best > 0) best -= 1;
      ratings.set(section.name, RATINGS[best]!);
    });
  }

  const trimmed: Record<string, string> = {};
  const shortened: string[] = [];
  const left: string[] = [];
  const sections = split.sections.map((section) => {
    const rating = ratings.get(section.name);
    const body = bodyOf(section);
    const heading = section.text.slice(0, section.text.indexOf("\n") + 1);
    if (rating === "not_needed") {
      trimmed[section.name] = body;
      left.push(section.name);
      return { ...section, text: `${heading}[Left out for this step: judged not needed (${body.length.toLocaleString()} characters). Read it with read_workflow_context if it turns out you need it.]\n` };
    }
    if (rating === "useful" && body.length > USEFUL_KEEP_CHARS * 1.2) {
      trimmed[section.name] = body;
      shortened.push(section.name);
      return { ...section, text: `${heading}${body.slice(0, USEFUL_KEEP_CHARS)}\n[… shortened for this step: ${(body.length - USEFUL_KEEP_CHARS).toLocaleString()} more characters. Read the whole part with read_workflow_context if you need it.]\n` };
    }
    return section;
  });
  if (left.length === 0 && shortened.length === 0) return undefined;
  const prompt = joinInput(split, sections);
  const parts = [
    left.length > 0 && `left out ${left.join(", ")}`,
    shortened.length > 0 && `shortened ${shortened.join(", ")}`,
  ].filter(Boolean);
  return {
    prompt,
    trimmed,
    note: `${parts.join("; ")} (${size.toLocaleString()} → ${(prompt.length - split.before.length - split.after.length).toLocaleString()} characters)`,
  };
}

/** The text of the step prompt in `request`: its user message holding `<workflow_input>`. */
export function stepPromptOf(request: Pick<ExecutionRequest, "messages">): string | undefined {
  for (const message of request.messages) {
    if (message.role !== "User" || !Array.isArray(message.content)) continue;
    for (const block of message.content as unknown[]) {
      const text = (block as { Text?: { text?: unknown } } | null)?.Text?.text;
      if (typeof text === "string" && text.includes("<workflow_input>")) return text;
    }
  }
  return undefined;
}

/** A copy of `request` whose step prompt `original` is replaced by `curated`. */
export function withCuratedPrompt(request: ExecutionRequest, original: string, curated: string): ExecutionRequest {
  let replaced = false;
  const messages = request.messages.map((message) => {
    if (message.role !== "User" || !Array.isArray(message.content)) return message;
    const content = (message.content as unknown[]).map((block) => {
      const text = (block as { Text?: { text?: unknown } } | null)?.Text?.text;
      if (text !== original) return block;
      replaced = true;
      return { ...(block as object), Text: { ...(block as { Text: object }).Text, text: curated } };
    });
    return { ...message, content } as typeof message;
  });
  return replaced ? { ...request, messages } : request;
}

/** Full text of the input parts shortened for each step, by step name then part name. */
export type TrimmedHandoffs = Record<string, Record<string, string>>;

export interface CurateStepDeps {
  request: ExecutionRequest;
  config: HandoffCurationRunConfig;
  /** The running workflow's definition: its input names delimit the parts. */
  definition: unknown;
  /** The run's scratch space: remembers each step's curation. */
  scratch: Record<string, unknown>;
  step?: string;
  signal?: AbortSignal;
  onEvent: (event: CapabilityEvent<"agent_chat">) => void;
  post?: typeof postJevDecision;
}

/**
 * The curated prompt of the step `request` belongs to: decided once, on the
 * step's first model turn (a new run id), and reused for its later turns,
 * which carry the same prompt. `undefined` sends the prompt as it is.
 */
export function curateStepRequest(deps: CurateStepDeps): Promise<{ original: string; prompt: string } | undefined> {
  const { request, scratch, step, onEvent } = deps;
  const cache = (scratch.handoffCurations ??= new Map<string, Promise<{ original: string; prompt: string } | undefined>>()) as Map<
    string,
    Promise<{ original: string; prompt: string } | undefined>
  >;
  let pending = cache.get(request.run_id);
  if (!pending) {
    const original = stepPromptOf(request);
    if (!original) {
      pending = Promise.resolve(undefined);
    } else {
      const guard = withTimeout(deps.signal, CURATION_TIMEOUT_MS);
      pending = curateHandoff({ config: deps.config, prompt: original, names: inputNames(deps.definition), signal: guard.signal, post: deps.post })
        .catch(() => undefined)
        .then((curated) => {
          if (!curated) return undefined;
          const trimmed = (scratch.trimmedHandoffs ??= {}) as TrimmedHandoffs;
          trimmed[step ?? request.run_id] = curated.trimmed;
          onEvent({ kind: "log", message: `Hand-off${step ? ` for ${step}` : ""}: ${curated.note}.` });
          onEvent({ kind: "progress", content: `↳ Hand-off${step ? ` for ${step}` : ""} · ${curated.note}` });
          return { original, prompt: curated.prompt };
        })
        .finally(() => guard.clear());
    }
    cache.set(request.run_id, pending);
  }
  return pending;
}
