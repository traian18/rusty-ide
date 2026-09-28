import { describe, expect, it, vi } from "vitest";
import type { RunHost } from "../../contract";
import type { ToolExecutionObserver } from "../../contract/observability";
import type { SessionRecipe } from "../SessionRecipe";
import type { postJevDecision } from "../../../services/intelligentModelSelector";
import { JevDecisionStats, calibrateJevDecisions, summarizeJevDecisionsByModel, type JevDecisionEntry } from "../../../services/jevDecisionStats";
import type { JevShadowEntry } from "../../../services/jevShadowStats";
import type { FollowUpCall } from "../toolDecisionObserver";
import type { DecideStepUpConfig } from "../decideToolConfig";
import type { CustomProvider } from "../../../store/types";
import {
  FOLLOW_UP_CALLS,
  DECIDE_PROMPT_SECTION,
  DECIDE_TOOL,
  MAX_DECIDE_ATTEMPTS,
  NEED_MORE_CONTEXT,
  applyDecideToolHandler,
  applyDecideToolToRecipe,
  buildDecideState,
  decideTool,
  parseDecideRequest,
} from "./decideTool";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

function choiceResponse(probabilities: Record<string, number>, confidence: number, choice?: string) {
  const top = choice ?? Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0][0];
  return {
    status: 200,
    ok: true,
    text: "",
    result: {
      answers: { decision: { type: "choice", choice: top, confidence, probabilities } },
      usage: { input_tokens: 400, output_tokens: 20, cost: 0.00002 },
    },
  };
}

function noulResponse(noul: number) {
  return { status: 200, ok: true, text: "", result: { answers: { decision: { type: "noul", noul } }, usage: { cost: 0.00001 } } };
}

const PROVIDER = { id: "p1", name: "Anthropic", baseUrl: "https://api.anthropic.com", apiKey: "sk-test", apiType: "anthropic-messages", models: [] } as unknown as CustomProvider;

const CHOICE_ARGS = {
  question: "How should the failing auth test be fixed?",
  kind: "choice",
  options: [
    { id: "patch_mock", criterion: "The mock returns a stale token shape; the implementation is right." },
    { id: "fix_impl", criterion: "The implementation regressed; the test expectation is right." },
  ],
  facts: ["auth::login fails with E0502 (cargo test)"],
  constraints: ["Do not change the public API"],
  tried: ["Re-ran the test: same failure"],
};

function observer(): ToolExecutionObserver & { steps: unknown[] } {
  const steps: unknown[] = [];
  return { steps, executedBy: vi.fn(), usage: vi.fn(), step: (...args: unknown[]) => void steps.push(args) };
}

function fakeHistory() {
  const watchers: Array<(call: FollowUpCall) => boolean> = [];
  return {
    watchers,
    describeHistoryBefore: vi.fn(() => "1. Called read_file {\"path\":\"auth.rs\"} → succeeded"),
    watchFollowUp: vi.fn((_runId: string, _sessionId: string, _callId: string, listener: (call: FollowUpCall) => boolean) => void watchers.push(listener)),
  };
}

const CALL = { runId: "run-1", sessionId: "s1", toolCallId: "d1", configureExecution: vi.fn(async () => {}) };

function setup(options: {
  post?: ReturnType<typeof vi.fn>;
  askQuestion?: RunHost["askQuestion"];
  history?: ReturnType<typeof fakeHistory>;
  proceedConfidence?: number;
  stepUp?: DecideStepUpConfig;
  log?: (message: string) => void;
} = {}) {
  const stats = new JevDecisionStats(memoryStorage());
  const post = options.post ?? vi.fn(async () => choiceResponse({ patch_mock: 0.85, fix_impl: 0.1, [NEED_MORE_CONTEXT]: 0.05 }, 0.8));
  const host = { askQuestion: options.askQuestion } as RunHost;
  const handler = decideTool({
    config: { apiKey: "or-key", jevModelId: "typesafe/jev-1.13", proceedConfidence: options.proceedConfidence, stepUp: options.stepUp },
    userRequest: "Fix the login tests",
    capability: "agent_chat",
    model: "claude-haiku-4-5",
    host,
    ctx: { scratch: {} },
    post: post as unknown as typeof postJevDecision,
    stats,
    history: () => options.history,
    provider: PROVIDER,
    log: options.log,
  });
  const signal = new AbortController().signal;
  return { handler, post, stats, call: (args: unknown, obs = observer(), context = CALL) => handler(args, signal, obs, context) };
}

describe("parseDecideRequest", () => {
  it("accepts a well-framed choice", () => {
    const parsed = parseDecideRequest(CHOICE_ARGS);
    expect(parsed.ok && parsed.request.options.map((option) => option.id)).toEqual(["patch_mock", "fix_impl"]);
  });

  it.each([
    [{ ...CHOICE_ARGS, question: " " }, /requires a question/],
    [{ ...CHOICE_ARGS, options: [CHOICE_ARGS.options[0]] }, /2-6 options/],
    [{ ...CHOICE_ARGS, options: [CHOICE_ARGS.options[0], CHOICE_ARGS.options[0]] }, /Duplicate/],
    [{ ...CHOICE_ARGS, options: [...CHOICE_ARGS.options, { id: NEED_MORE_CONTEXT, criterion: "x" }] }, /reserved/],
    [{ ...CHOICE_ARGS, options: [{ id: "a", criterion: "" }, CHOICE_ARGS.options[1]] }, /non-empty id and criterion/],
    [{ ...CHOICE_ARGS, facts: [] }, /at least one fact/],
    [{ ...CHOICE_ARGS, kind: "yes_no" }, /ids 'yes' and 'no'/],
    [{ ...CHOICE_ARGS, kind: "maybe" }, /'choice' or 'yes_no'/],
  ])("rejects a badly framed request (%#)", (args, error) => {
    const parsed = parseDecideRequest(args);
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.error).toMatch(error);
  });
});

describe("decide tool", () => {
  it("sends the facts as state, adds the escape option, and tells the agent to proceed when JEV is confident", async () => {
    const { call, post, stats } = setup();
    const obs = observer();
    const outcome = await call(CHOICE_ARGS, obs);

    const [apiKey, body] = post.mock.calls[0] as [string, { model: string; state: string; questions: { decision: { type: string; criteria: Record<string, string> } } }];
    expect(apiKey).toBe("or-key");
    expect(body.model).toBe("typesafe/jev-1.13");
    expect(body.questions.decision.type).toBe("choice");
    expect(Object.keys(body.questions.decision.criteria)).toEqual(["patch_mock", "fix_impl", NEED_MORE_CONTEXT]);
    expect(body.state).toContain("Fix the login tests");
    expect(body.state).toContain("- auth::login fails with E0502 (cargo test)");
    expect(body.state).toContain("Constraints:\n- Do not change the public API");
    expect(body.state).toContain("Already tried:\n- Re-ran the test: same failure");

    expect(outcome).toEqual({ ok: true, output: expect.stringMatching(/^Decision: patch_mock \(confidence 80%\)\.\nWhy it applies: The mock/) });
    expect(obs.executedBy).toHaveBeenCalledWith(expect.objectContaining({ kind: "model", model: "typesafe/jev-1.13" }));
    expect(obs.usage).toHaveBeenCalledWith(expect.objectContaining({ input_tokens: 400 }));
    expect(stats.getEntries()[0]).toMatchObject({ model: "claude-haiku-4-5", band: "proceed", choice: "patch_mock", attempt: 1, cost: 0.00002 });
  });

  it("sends the agent back for evidence when JEV is unsure, then escalates to the user on the last attempt", async () => {
    const unsure = vi.fn(async () => choiceResponse({ patch_mock: 0.3, fix_impl: 0.25, [NEED_MORE_CONTEXT]: 0.45 }, 0.3));
    const askQuestion = vi.fn(async () => "fix_impl");
    const { call, stats } = setup({ post: unsure, askQuestion });

    for (let attempt = 1; attempt < MAX_DECIDE_ATTEMPTS; attempt += 1) {
      const outcome = await call(CHOICE_ARGS);
      expect(outcome).toEqual({ ok: true, output: expect.stringContaining(`No decision yet (attempt ${attempt} of ${MAX_DECIDE_ATTEMPTS}). Leaning patch_mock (30%) over fix_impl (25%).`) });
      expect(outcome.ok && outcome.output).toContain("not enough to choose");
    }
    const outcome = await call(CHOICE_ARGS);

    expect(askQuestion).toHaveBeenCalledWith(expect.objectContaining({
      question: CHOICE_ARGS.question,
      options: [
        { label: "patch_mock", description: CHOICE_ARGS.options[0].criterion },
        { label: "fix_impl", description: CHOICE_ARGS.options[1].criterion },
      ],
    }), expect.anything());
    expect(outcome).toEqual({ ok: true, output: expect.stringContaining("the user, who answered: fix_impl") });
    expect(stats.getEntries().map((entry) => entry.band)).toEqual(["verify", "verify", "escalate"]);
    expect(stats.getEntries()[2]).toMatchObject({ resolvedBy: "user", attempt: 3 });

    // Escalation settles the question: asking again starts from attempt 1.
    await call(CHOICE_ARGS);
    expect(stats.getEntries()[3]).toMatchObject({ attempt: 1 });
  });

  it("uses JEV's best real option when it cannot ask the user", async () => {
    const unsure = vi.fn(async () => choiceResponse({ patch_mock: 0.2, fix_impl: 0.35, [NEED_MORE_CONTEXT]: 0.45 }, 0.3));
    const { call, stats } = setup({ post: unsure });
    for (let attempt = 1; attempt < MAX_DECIDE_ATTEMPTS; attempt += 1) await call(CHOICE_ARGS);
    const outcome = await call(CHOICE_ARGS);

    expect(outcome).toEqual({ ok: true, output: expect.stringMatching(/^Decision \(low confidence, best guess\): fix_impl/) });
    expect(stats.getEntries()[2]).toMatchObject({ band: "escalate", resolvedBy: "best_guess" });
  });

  it("counts attempts per question, so a different decision starts fresh", async () => {
    const unsure = vi.fn(async () => choiceResponse({ patch_mock: 0.4, fix_impl: 0.35, [NEED_MORE_CONTEXT]: 0.25 }, 0.3));
    const { call, stats } = setup({ post: unsure });
    await call(CHOICE_ARGS);
    await call({ ...CHOICE_ARGS, question: "Which file should hold the new helper?" });
    expect(stats.getEntries().map((entry) => entry.attempt)).toEqual([1, 1]);
  });

  it("maps yes/no answers onto the same confidence threshold", async () => {
    const yesNo = {
      question: "Is the task complete?",
      kind: "yes_no",
      options: [{ id: "yes", criterion: "All requested endpoints exist and tests pass." }, { id: "no", criterion: "Something requested is missing or failing." }],
      facts: ["npm test: 42 passed"],
    };
    const confident = setup({ post: vi.fn(async () => noulResponse(0.9)) });
    expect(await confident.call(yesNo)).toEqual({ ok: true, output: expect.stringMatching(/^Decision: yes \(confidence 80%\)/) });
    const body = (confident.post.mock.calls[0] as unknown[])[1] as { questions: { decision: unknown } };
    expect(body.questions.decision).toEqual({
      type: "noul",
      instructions: "Is the task complete?",
      criteria: { true: yesNo.options[0].criterion, false: yesNo.options[1].criterion },
    });

    const unsure = setup({ post: vi.fn(async () => noulResponse(0.6)) });
    expect(await unsure.call(yesNo)).toEqual({ ok: true, output: expect.stringContaining("No decision yet") });
  });

  it("returns an actionable error and records it when JEV fails", async () => {
    const { call, stats } = setup({ post: vi.fn(async () => ({ status: 503, ok: false, text: "busy" })) });
    const outcome = await call(CHOICE_ARGS);
    expect(outcome).toEqual({ ok: false, error: expect.stringContaining("decision service is unavailable (HTTP 503)") });
    expect(stats.getEntries()[0]).toMatchObject({ error: "HTTP 503" });
    expect(stats.getEntries()[0].band).toBeUndefined();
  });

  it("rejects a badly framed request without calling JEV", async () => {
    const { call, post } = setup();
    expect(await call({ ...CHOICE_ARGS, facts: [] })).toEqual({ ok: false, error: expect.stringContaining("at least one fact") });
    expect(post).not.toHaveBeenCalled();
  });
});

describe("decide state", () => {
  it("clips long lists to fit JEV's window, keeping the first facts", () => {
    const parsed = parseDecideRequest({ ...CHOICE_ARGS, facts: Array.from({ length: 50 }, (_, index) => `fact ${index} ${"x".repeat(500)}`) });
    const state = buildDecideState(parsed.ok ? parsed.request : (undefined as never), "Fix it");
    expect(state).toContain("- fact 0 ");
    expect(state).toMatch(/\[\d+ more omitted\]/);
    expect(state.length).toBeLessThan(12_000);
  });
});

describe("decide wiring", () => {
  const recipe = { workspace: { root: "/ws" }, integration: "x", system_prompt: "Base prompt", host_tools: [] } as SessionRecipe;
  const config = { apiKey: "k", jevModelId: "typesafe/jev-1.13" };

  it("offers the tool and its guidance only when the run has a JEV config", () => {
    expect(applyDecideToolToRecipe(recipe, undefined)).toBe(recipe);
    const applied = applyDecideToolToRecipe(recipe, config);
    expect(applied.host_tools).toEqual([DECIDE_TOOL]);
    expect(applied.system_prompt).toBe(`Base prompt${DECIDE_PROMPT_SECTION}`);
    expect(applied.system_prompt).not.toMatch(/JEV/);
  });

  it("registers the handler only with a config", () => {
    const base = { userRequest: "", capability: "agent_chat" as const, model: "m", host: {} as RunHost, ctx: { scratch: {} } };
    expect(Object.keys(applyDecideToolHandler({}, { ...base, config: undefined }))).toEqual([]);
    expect(Object.keys(applyDecideToolHandler({}, { ...base, config }))).toEqual(["decide"]);
  });
});

describe("summarizeJevDecisionsByModel", () => {
  it("summarizes bands, insufficient-facts answers, and cost per model", () => {
    const summaries = summarizeJevDecisionsByModel([
      { id: "1", at: "", capability: "agent_chat", model: "a", kind: "choice", question: "q", attempt: 1, band: "verify", choice: NEED_MORE_CONTEXT, confidence: 0.3, cost: 0.1 },
      { id: "2", at: "", capability: "agent_chat", model: "a", kind: "choice", question: "q", attempt: 2, band: "proceed", choice: "x", confidence: 0.9, cost: 0.1 },
      { id: "3", at: "", capability: "agent_chat", model: "a", kind: "choice", question: "q", attempt: 1, error: "HTTP 503" },
    ]);
    expect(summaries).toEqual([{
      model: "a",
      decisions: 2,
      bands: { proceed: 1, verify: 1, escalate: 0 },
      needMoreContext: 1,
      errors: 1,
      averageConfidence: 0.6,
      cost: 0.2,
      steppedUp: 0,
      followUpCalls: 0,
      followUpFailed: 0,
      followUpScored: 0,
      followUpFlagged: 0,
    }]);
  });
});

describe("decide calibration inputs", () => {
  it("includes the agent's earlier steps in the state JEV sees", async () => {
    const history = fakeHistory();
    const { call, post } = setup({ history });
    await call(CHOICE_ARGS);

    expect(history.describeHistoryBefore).toHaveBeenCalledWith("run-1", "s1", "d1");
    const body = (post.mock.calls[0] as unknown[])[1] as { state: string };
    expect(body.state).toContain("What the agent has done so far (oldest first):\n1. Called read_file");
    expect(body.state.indexOf("done so far")).toBeLessThan(body.state.indexOf("Facts the agent gathered"));
  });

  it("links the agent's next calls to a decision it acted on, up to the follow-up limit", async () => {
    const history = fakeHistory();
    const { call, stats } = setup({ history });
    await call(CHOICE_ARGS);

    expect(history.watchFollowUp).toHaveBeenCalledWith("run-1", "s1", "d1", expect.any(Function));
    const [listener] = history.watchers;
    const results = Array.from({ length: FOLLOW_UP_CALLS }, (_, index) => listener({ callId: `c${index}`, tool: "write_file", failed: index === 1 }));
    expect(results.at(-1)).toBe(false);
    expect(results.slice(0, -1).every(Boolean)).toBe(true);
    expect(stats.getEntries()[0]).toMatchObject({
      followUpCallIds: Array.from({ length: FOLLOW_UP_CALLS }, (_, index) => `s1:c${index}`),
      followUpFailed: 1,
    });
  });

  it("does not follow up a decision that sent the agent back for evidence", async () => {
    const history = fakeHistory();
    const { call } = setup({ history, post: vi.fn(async () => choiceResponse({ patch_mock: 0.4, fix_impl: 0.35, [NEED_MORE_CONTEXT]: 0.25 }, 0.3)) });
    await call(CHOICE_ARGS);
    expect(history.watchFollowUp).not.toHaveBeenCalled();
  });

  it("acts only at or above the run's configured confidence", async () => {
    const strict = setup({ proceedConfidence: 0.85 });
    expect(await strict.call(CHOICE_ARGS)).toEqual({ ok: true, output: expect.stringContaining("No decision yet") });
    const lenient = setup({ proceedConfidence: 0.5, post: vi.fn(async () => choiceResponse({ patch_mock: 0.6, fix_impl: 0.3, [NEED_MORE_CONTEXT]: 0.1 }, 0.55)) });
    expect(await lenient.call(CHOICE_ARGS)).toEqual({ ok: true, output: expect.stringMatching(/^Decision: patch_mock/) });
  });
});

describe("calibrateJevDecisions", () => {
  const decision = (id: string, confidence: number, patch: Partial<JevDecisionEntry> = {}): JevDecisionEntry => ({
    id, at: "", capability: "agent_chat", model: "a", kind: "choice", question: "q", attempt: 1, band: "proceed", choice: "x", confidence, ...patch,
  });
  const shadow = (id: string, verdict: JevShadowEntry["verdict"]): JevShadowEntry => ({ id, at: "", runId: "r", capability: "agent_chat", model: "a", tool: "t", verdict });

  it("groups acted-on decisions by confidence and joins the shadow gate's verdicts on the calls that followed", () => {
    const buckets = calibrateJevDecisions([
      decision("1", 0.65, { followUpCallIds: ["s:c1", "s:c2"], followUpFailed: 1 }),
      decision("2", 0.62, { followUpCallIds: ["s:c3"], followUpFailed: 0 }),
      decision("3", 1, { followUpCallIds: ["s:c4"] }),
      decision("4", 0.35, { band: "escalate", resolvedBy: "best_guess" }),
      decision("5", 0.3, { band: "escalate", resolvedBy: "user" }),
      decision("6", 0.3, { band: "verify" }),
    ], [shadow("s:c1", "revise"), shadow("s:c2", "proceed"), shadow("s:c4", "stop")]);

    const byFrom = Object.fromEntries(buckets.map((bucket) => [bucket.from, bucket]));
    expect(byFrom[0.6]).toMatchObject({ decisions: 2, followUpCalls: 3, followUpFailed: 1, followUpScored: 2, followUpFlagged: 1 });
    expect(byFrom[0.9]).toMatchObject({ decisions: 1, followUpCalls: 1, followUpScored: 1, followUpFlagged: 1 });
    expect(byFrom[0]).toMatchObject({ decisions: 1 });
    expect(buckets.reduce((sum, bucket) => sum + bucket.decisions, 0)).toBe(4);
  });
});

describe("decide model step-up", () => {
  const STEP_UP: DecideStepUpConfig = {
    level: "light",
    levels: {
      light: { providerId: "p1", model: "claude-haiku-4-5", name: "Haiku" },
      standard: { providerId: "p1", model: "claude-sonnet-4-5", name: "Sonnet" },
      heavy: { providerId: "p1", model: "claude-opus-4-1", name: "Opus" },
    },
  };

  function withLevel(levelProbabilities: [number, number, number], levelConfidence: number) {
    const response = choiceResponse({ patch_mock: 0.85, fix_impl: 0.1, [NEED_MORE_CONTEXT]: 0.05 }, 0.8);
    (response.result.answers as Record<string, unknown>).level = {
      type: "score",
      confidence: levelConfidence,
      probabilities: { "0": levelProbabilities[0], "1": levelProbabilities[1], "2": levelProbabilities[2] },
    };
    return response;
  }

  function context() {
    const order: string[] = [];
    const configureExecution = vi.fn(async () => void order.push("configured"));
    return { order, configureExecution, call: { ...CALL, configureExecution } };
  }

  it("switches the session to the level JEV rates the remaining work at, before returning the decision", async () => {
    const log = vi.fn();
    const { order, configureExecution, call: callContext } = context();
    const { call, post, stats } = setup({ stepUp: STEP_UP, log, post: vi.fn(async () => withLevel([0.05, 0.1, 0.85], 0.8)) });

    const outcome = await call(CHOICE_ARGS, observer(), callContext).then((result) => {
      order.push("returned");
      return result;
    });

    const body = (post.mock.calls[0] as unknown[])[1] as { questions: Record<string, { type: string }> };
    expect(body.questions.level.type).toBe("score");
    expect(configureExecution).toHaveBeenCalledWith({ model: "claude-opus-4-1" });
    expect(order).toEqual(["configured", "returned"]);
    expect(outcome).toEqual({ ok: true, output: expect.stringMatching(/^Decision: patch_mock/) });
    expect(outcome.ok && outcome.output).not.toMatch(/Opus|model/i);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^Switched to Opus \(Heavy\)/));
    expect(stats.getEntries()[0]).toMatchObject({ assessedLevel: "heavy", steppedUpTo: "heavy" });
  });

  it("stops asking about difficulty once the run is at the highest reachable level", async () => {
    const { call: callContext } = context();
    const { call, post } = setup({ stepUp: STEP_UP, post: vi.fn(async () => withLevel([0.05, 0.1, 0.85], 0.8)) });
    await call(CHOICE_ARGS, observer(), callContext);
    await call({ ...CHOICE_ARGS, question: "Which file next?" }, observer(), callContext);

    const second = (post.mock.calls[1] as unknown[])[1] as { questions: Record<string, unknown> };
    expect(Object.keys(second.questions)).toEqual(["decision"]);
  });

  it("stays on the current model when JEV is unsure about the remaining work", async () => {
    const { configureExecution, call: callContext } = context();
    const { call, stats } = setup({ stepUp: STEP_UP, post: vi.fn(async () => withLevel([0.2, 0.35, 0.45], 0.4)) });
    await call(CHOICE_ARGS, observer(), callContext);
    expect(configureExecution).not.toHaveBeenCalled();
    expect(stats.getEntries()[0]).toMatchObject({ assessedLevel: "heavy" });
    expect(stats.getEntries()[0].steppedUpTo).toBeUndefined();
  });

  it("still returns the decision when switching fails", async () => {
    const configureExecution = vi.fn(async () => { throw new Error("session closed"); });
    const obs = observer();
    const { call, stats } = setup({ stepUp: STEP_UP, post: vi.fn(async () => withLevel([0.05, 0.1, 0.85], 0.8)) });
    const outcome = await call(CHOICE_ARGS, obs, { ...CALL, configureExecution });

    expect(outcome).toEqual({ ok: true, output: expect.stringMatching(/^Decision: patch_mock/) });
    expect(stats.getEntries()[0].steppedUpTo).toBeUndefined();
    expect(obs.steps).toContainEqual(["warn", expect.stringContaining("Stepping the run up failed"), expect.objectContaining({ error: "session closed" })]);
  });

  it("does not ask about difficulty in runs AUTO did not size", async () => {
    const { call, post } = setup();
    await call(CHOICE_ARGS);
    const body = (post.mock.calls[0] as unknown[])[1] as { questions: Record<string, unknown> };
    expect(Object.keys(body.questions)).toEqual(["decision"]);
  });
});
