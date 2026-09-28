import { NOOP_TOOL_EXECUTION_OBSERVER, type ToolExecutionObserver } from "../../contract/observability";
import type { CapabilityName, RunHost } from "../../contract";
import { commandSignature, type NormalizedCommand } from "../../commandPolicy";
import type { HostToolCall, HostToolHandler } from "../CoreHarness";
import type { JevRiskReviewRunConfig } from "../decideToolConfig";
import { commandRisk, writeRisk } from "../riskyActions";
import { toolDecisionObserver, type ToolDecisionObserver } from "../toolDecisionObserver";
import { resolveWriteTarget } from "./exploreTools";
import { normalizeCommand } from "./runCommandTool";
import { JEV_CONFIDENCE_THRESHOLD, postJevDecision, type JevDecisionResponse, type JevScoreAnswer } from "../../../services/intelligentModelSelector";
import { JEV_ACTION_CRITERIA, JEV_ACTION_LABELS, actionDecisionBody, buildReviewState, parseActionAnswer, type ScoredAction } from "../../../services/jevShadowGate";
import { jevReviewStats, type JevReviewOutcome, type JevReviewStats } from "../../../services/jevReviewStats";

export interface RiskReviewDependencies {
  config: JevRiskReviewRunConfig;
  /** The request the run was started with. */
  userRequest: string;
  capability: CapabilityName;
  /** The model that runs the session and proposes the actions. */
  model: string;
  workspaceRoot: string;
  inputFiles?: unknown;
  post?: typeof postJevDecision;
  stats?: JevReviewStats;
  history?: () => Pick<ToolDecisionObserver, "describeHistoryBefore"> | undefined;
}

interface Review {
  statsId: string;
  scored?: ScoredAction;
  error?: string;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

function stringify(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value) ?? "null";
  } catch {
    return String(value);
  }
}

function describeReview(review: Review): string {
  return review.scored
    ? `Automated review (JEV): ${JEV_ACTION_LABELS[review.scored.verdict]} at ${percent(review.scored.confidence)} confidence.`
    : `Automated review could not run (${review.error ?? "no answer"}).`;
}

/**
 * Enforced review of risky actions: a `write_file` that would destroy
 * existing content, or a destructive `run_command`. JEV judges the action
 * before it runs, with the shadow gate's Proceed/Revise/Stop rubric:
 * - Proceed, confidently: it runs (a command still asks the user as usual).
 * - Revise: it is blocked, and the agent is told why so it can fix the step.
 * - Stop, unsure, or JEV unavailable: the user decides -- in the command's own
 *   permission dialog, or with a question for a write; without a user, the
 *   write is blocked.
 * Actions that are not risky are never delayed.
 */
export function createRiskReview(dependencies: RiskReviewDependencies) {
  const post = dependencies.post ?? postJevDecision;
  const stats = dependencies.stats ?? jevReviewStats;
  const history = dependencies.history ?? toolDecisionObserver;
  const { config } = dependencies;
  const threshold = config.proceedConfidence ?? JEV_CONFIDENCE_THRESHOLD;
  /** A flagged command's review, shown in (and settled by) its permission dialog. */
  const pendingCommands = new Map<string, { note: string; statsId: string }>();

  const settle = (statsId: string, outcome: JevReviewOutcome) => stats.update(statsId, { outcome });

  async function review(
    tool: string,
    args: unknown,
    concern: string,
    signal: AbortSignal,
    observer: ToolExecutionObserver,
    call: HostToolCall | undefined,
  ): Promise<Review> {
    const statsId = `review_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    stats.update(statsId, {}, {
      at: new Date().toISOString(),
      capability: dependencies.capability,
      model: dependencies.model,
      tool,
      concern,
    });
    const recentSteps = call?.toolCallId ? history()?.describeHistoryBefore?.(call.runId, call.sessionId, call.toolCallId) : undefined;
    const body = actionDecisionBody(config.jevModelId, buildReviewState({
      prompt: dependencies.userRequest,
      history: recentSteps,
      tool,
      arguments: stringify(args),
      concern,
    }));
    const failed = (error: string): Review => {
      stats.update(statsId, { error });
      observer.step("warn", `JEV review could not run: ${error}`, { concern, request: body });
      return { statsId, error };
    };
    let response: JevDecisionResponse<{ answers?: { action?: JevScoreAnswer }; usage?: { cost?: number } }>;
    try {
      response = await post(config.apiKey, body, signal);
    } catch (error: unknown) {
      if (signal.aborted) throw error;
      return failed(error instanceof Error ? error.message : String(error));
    }
    if (!response.ok) return failed(`HTTP ${response.status}`);
    const scored = parseActionAnswer(response.result);
    if (!scored) return failed("invalid answer");
    stats.update(statsId, { verdict: scored.verdict, confidence: scored.confidence, cost: scored.cost });
    observer.step(
      scored.verdict === "proceed" ? "info" : "warn",
      `JEV review (${config.jevModelId}): ${JEV_ACTION_LABELS[scored.verdict]} at ${percent(scored.confidence)} confidence. ${concern}`,
      { probabilities: scored.probabilities, cost: scored.cost, request: body },
    );
    return { statsId, scored };
  }

  const approved = (review: Review) => review.scored?.verdict === "proceed" && review.scored.confidence >= threshold;

  function blocked(review: Review, concern: string, fix: string) {
    settle(review.statsId, "blocked");
    return {
      ok: false as const,
      error: [
        `Blocked before it ran. ${concern}`,
        `A review judged this step flawed but fixable (${percent(review.scored!.confidence)} confident): ${JEV_ACTION_CRITERIA.revise}`,
        `${fix} If the right approach is unclear, use 'decide' when it is available, or 'ask_user_question'.`,
      ].join("\n"),
    };
  }

  function wrapWrite(inner: HostToolHandler, host: RunHost): HostToolHandler {
    return async (args, signal, observer = NOOP_TOOL_EXECUTION_OBSERVER, call) => {
      const content = String((args as { content?: unknown } | undefined)?.content ?? "");
      const target = resolveWriteTarget(dependencies.workspaceRoot, args, dependencies.inputFiles);
      let previous: string | undefined;
      try {
        previous = await host.readFile(target, signal);
      } catch {
        previous = undefined;
      }
      const concern = writeRisk(previous, content);
      if (!concern) return inner(args, signal, observer, call);

      const result = await review("write_file", args, concern, signal, observer, call);
      if (approved(result)) {
        settle(result.statsId, "allowed");
        return inner(args, signal, observer, call);
      }
      if (result.scored?.verdict === "revise") {
        return blocked(result, concern, "Write the file's complete intended content, keeping everything that should stay.");
      }
      if (!host.askQuestion) {
        settle(result.statsId, "blocked_unattended");
        return {
          ok: false,
          error: `Not written: ${concern} ${describeReview(result)} No user is available to approve it; write the file's complete intended content instead.`,
        };
      }
      let answer: string;
      try {
        answer = await host.askQuestion({
          requestId: crypto.randomUUID(),
          question: `Allow the agent to overwrite ${target}? ${concern} ${describeReview(result)}`,
          options: [
            { label: "Allow", description: "Write the file as the agent proposed." },
            { label: "Block", description: "Don't write it; the agent is told to write the complete content instead." },
          ],
        }, signal);
      } catch (error: unknown) {
        if (signal.aborted) throw error;
        settle(result.statsId, "blocked_unattended");
        return { ok: false, error: `Not written: ${concern} The user could not be asked for approval.` };
      }
      if (answer.trim().toLowerCase() === "allow") {
        settle(result.statsId, "user_allowed");
        return inner(args, signal, observer, call);
      }
      settle(result.statsId, "user_blocked");
      const said = answer.trim() && answer.trim().toLowerCase() !== "block" ? ` The user said: ${answer.trim()}` : "";
      return { ok: false, error: `The user blocked this write. ${concern}${said}` };
    };
  }

  function wrapCommand(inner: HostToolHandler): HostToolHandler {
    return async (args, signal, observer = NOOP_TOOL_EXECUTION_OBSERVER, call) => {
      let command: NormalizedCommand;
      try {
        command = normalizeCommand(args, dependencies.workspaceRoot);
      } catch {
        return inner(args, signal, observer, call);
      }
      const concern = commandRisk(command);
      if (!concern) return inner(args, signal, observer, call);

      const result = await review("run_command", args, concern, signal, observer, call);
      if (approved(result)) {
        settle(result.statsId, "allowed");
        return inner(args, signal, observer, call);
      }
      if (result.scored?.verdict === "revise") {
        return blocked(result, concern, "Use a safer or more targeted command, or first check whether this one is needed.");
      }
      // The command's own permission dialog asks the user, now with the review attached.
      pendingCommands.set(commandSignature(command), { note: `${describeReview(result)} ${concern}`, statsId: result.statsId });
      return inner(args, signal, observer, call);
    };
  }

  return {
    /** A host whose command permission dialogs carry a flagged command's review. */
    host(host: RunHost): RunHost {
      return Object.assign(Object.create(host) as RunHost, {
        requestPermission: async (...[request, signal]: Parameters<RunHost["requestPermission"]>) => {
          const key = commandSignature(request.command);
          const pending = pendingCommands.get(key);
          if (!pending) return host.requestPermission(request, signal);
          pendingCommands.delete(key);
          const decision = await host.requestPermission({ ...request, description: `${request.description}\n\n${pending.note}` }, signal);
          settle(pending.statsId, decision === "deny" ? "user_blocked" : "user_allowed");
          return decision;
        },
      });
    },
    /** Reviews the risky calls of the handlers the capability registered. */
    wrap(handlers: Record<string, HostToolHandler>, host: RunHost): Record<string, HostToolHandler> {
      if (handlers.write_file) handlers.write_file = wrapWrite(handlers.write_file, host);
      if (handlers.run_command) handlers.run_command = wrapCommand(handlers.run_command);
      return handlers;
    },
  };
}
