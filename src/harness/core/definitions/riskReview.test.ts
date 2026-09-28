import { describe, expect, it, vi } from "vitest";
import type { CommandPermissionRequest, RunHost } from "../../contract";
import type { HostToolHandler } from "../CoreHarness";
import type { postJevDecision } from "../../../services/intelligentModelSelector";
import { JevReviewStats } from "../../../services/jevReviewStats";
import { createRiskReview } from "./riskReview";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

/** A score answer over [Proceed, Revise, Stop]. */
function verdict(probabilities: [number, number, number], confidence = 0.8) {
  return {
    status: 200,
    ok: true,
    text: "",
    result: { answers: { action: { type: "score", confidence, probabilities: { "0": probabilities[0], "1": probabilities[1], "2": probabilities[2] } } }, usage: { cost: 0.00002 } },
  };
}

const PROCEED = verdict([0.85, 0.1, 0.05]);
const REVISE = verdict([0.1, 0.8, 0.1]);
const STOP = verdict([0.05, 0.15, 0.8]);
const UNSURE = verdict([0.45, 0.3, 0.25], 0.3);

const ORIGINAL = Array.from({ length: 40 }, (_, index) => `const line${index} = ${index};`).join("\n");
const TRUNCATED = "const line0 = 0;\n// ... rest of the file unchanged\n";

function setup(options: { response?: unknown; post?: ReturnType<typeof vi.fn>; askQuestion?: RunHost["askQuestion"]; existing?: string } = {}) {
  const stats = new JevReviewStats(memoryStorage());
  const post = options.post ?? vi.fn(async () => options.response ?? PROCEED);
  const host = {
    readFile: vi.fn(async () => {
      if (options.existing === undefined) throw new Error("No such file");
      return options.existing;
    }),
    writeFile: vi.fn(async () => {}),
    requestPermission: vi.fn(async () => "allow_once" as const),
    askQuestion: options.askQuestion,
  } as unknown as RunHost & { requestPermission: ReturnType<typeof vi.fn> };
  const review = createRiskReview({
    config: { apiKey: "or-key", jevModelId: "typesafe/jev-1.13" },
    userRequest: "Add a health-check endpoint",
    capability: "agent_chat",
    model: "cheap/model",
    workspaceRoot: "/ws",
    post: post as unknown as typeof postJevDecision,
    stats,
    history: () => ({ describeHistoryBefore: () => "1. Called read_file {\"path\":\"server.ts\"} → succeeded" }),
  });
  const write = vi.fn<HostToolHandler>(async () => ({ ok: true, output: "written" }));
  // The base command handler asks the (reviewed) host for permission, like gatedRunCommandTool.
  const reviewedHost = review.host(host);
  const command = vi.fn<HostToolHandler>(async (args) => {
    const { program, args: argv } = args as { program: string; args: string[] };
    const decision = await reviewedHost.requestPermission({
      requestId: "r1",
      sessionId: "tab-1",
      command: { program, args: argv, cwd: "/ws", timeoutMs: 300_000 },
      risk: "destructive",
      sessionGrantScope: "exact_command",
      sessionGrantProgram: program,
      description: `The agent wants to run: ${program} ${argv.join(" ")}`,
    } as CommandPermissionRequest, new AbortController().signal);
    return decision === "deny" ? { ok: false, error: "Command denied by the user." } : { ok: true, output: "ran" };
  });
  const handlers = review.wrap({ write_file: write, run_command: command }, host);
  const call = { runId: "run-1", sessionId: "s1", toolCallId: "c1", configureExecution: async () => {} };
  const signal = new AbortController().signal;
  return {
    stats,
    post,
    host,
    reviewedHost,
    write,
    command,
    writeFile: (content: string) => handlers.write_file({ path: "server.ts", content }, signal, undefined, call),
    run: (program: string, argv: string[]) => handlers.run_command({ program, args: argv }, signal, undefined, call),
  };
}

describe("risky write review", () => {
  it("never reviews a write that is not risky", async () => {
    const { writeFile, write, post } = setup({ existing: ORIGINAL });
    await writeFile(`${ORIGINAL}\nconst added = 1;`);
    expect(write).toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    await setup().writeFile("brand new file");
  });

  it("reviews a destructive rewrite with the agent's history and the concern, and lets a confident Proceed run", async () => {
    const { writeFile, write, post, stats } = setup({ existing: ORIGINAL, response: PROCEED });
    const outcome = await writeFile(TRUNCATED);

    const body = (post.mock.calls[0] as unknown[])[1] as { state: string };
    expect(body.state).toContain("Add a health-check endpoint");
    expect(body.state).toContain("1. Called read_file");
    expect(body.state).toContain("Tool: write_file");
    expect(body.state).toMatch(/Why this action needs review: The new content contains a placeholder/);
    expect(outcome).toEqual({ ok: true, output: "written" });
    expect(write).toHaveBeenCalledTimes(1);
    expect(stats.getEntries()[0]).toMatchObject({ tool: "write_file", verdict: "proceed", outcome: "allowed", model: "cheap/model" });
  });

  it("blocks a write JEV judges flawed and tells the agent how to fix it", async () => {
    const { writeFile, write, stats } = setup({ existing: ORIGINAL, response: REVISE });
    const outcome = await writeFile(TRUNCATED);
    expect(write).not.toHaveBeenCalled();
    expect(outcome).toEqual({ ok: false, error: expect.stringMatching(/^Blocked before it ran\. The new content contains a placeholder/) });
    expect(!outcome.ok && outcome.error).toContain("Write the file's complete intended content");
    expect(stats.getEntries()[0]).toMatchObject({ verdict: "revise", outcome: "blocked" });
  });

  it.each([
    ["Stop", STOP],
    ["an unsure review", UNSURE],
  ])("asks the user after %s, and writes only if they allow it", async (_name, response) => {
    const allow = setup({ existing: ORIGINAL, response, askQuestion: vi.fn(async () => "Allow") });
    expect(await allow.writeFile("")).toEqual({ ok: true, output: "written" });
    expect(allow.stats.getEntries()[0]).toMatchObject({ outcome: "user_allowed" });

    const askQuestion = vi.fn(async () => "Block");
    const block = setup({ existing: ORIGINAL, response, askQuestion });
    expect(await block.writeFile("")).toEqual({ ok: false, error: "The user blocked this write. It empties an existing file of 40 lines." });
    expect(block.write).not.toHaveBeenCalled();
    expect(askQuestion).toHaveBeenCalledWith(expect.objectContaining({
      question: expect.stringMatching(/^Allow the agent to overwrite \/ws\/server\.ts\? It empties an existing file of 40 lines\. Automated review \(JEV\): /),
      options: [expect.objectContaining({ label: "Allow" }), expect.objectContaining({ label: "Block" })],
    }), expect.anything());
    expect(block.stats.getEntries()[0]).toMatchObject({ outcome: "user_blocked" });
  });

  it("asks the user when JEV cannot review, and blocks when there is no user to ask", async () => {
    const down = vi.fn(async () => ({ status: 503, ok: false, text: "busy" }));
    const askQuestion = vi.fn<NonNullable<RunHost["askQuestion"]>>(async () => "Allow");
    const attended = setup({ existing: ORIGINAL, post: down, askQuestion });
    expect(await attended.writeFile("")).toEqual({ ok: true, output: "written" });
    expect(askQuestion.mock.calls[0][0].question).toContain("Automated review could not run (HTTP 503)");
    expect(attended.stats.getEntries()[0]).toMatchObject({ error: "HTTP 503", outcome: "user_allowed" });

    const unattended = setup({ existing: ORIGINAL, response: STOP });
    const outcome = await unattended.writeFile("");
    expect(outcome).toEqual({ ok: false, error: expect.stringContaining("No user is available to approve it") });
    expect(unattended.write).not.toHaveBeenCalled();
    expect(unattended.stats.getEntries()[0]).toMatchObject({ outcome: "blocked_unattended" });
  });
});

describe("destructive command review", () => {
  it("never reviews a command that is not destructive", async () => {
    const { run, post, command } = setup();
    await run("npm", ["test"]);
    expect(post).not.toHaveBeenCalled();
    expect(command).toHaveBeenCalled();
  });

  it("lets a confident Proceed through to the usual permission dialog, unchanged", async () => {
    const { run, host, stats } = setup({ response: PROCEED });
    expect(await run("git", ["push"])).toEqual({ ok: true, output: "ran" });
    expect(host.requestPermission.mock.calls[0][0].description).toBe("The agent wants to run: git push");
    expect(stats.getEntries()[0]).toMatchObject({ tool: "run_command", outcome: "allowed" });
  });

  it("blocks a command JEV judges flawed before the user is asked", async () => {
    const { run, host, command } = setup({ response: REVISE });
    const outcome = await run("git", ["reset", "--hard"]);
    expect(outcome).toEqual({ ok: false, error: expect.stringMatching(/^Blocked before it ran\. It is a destructive command/) });
    expect(command).not.toHaveBeenCalled();
    expect(host.requestPermission).not.toHaveBeenCalled();
  });

  it("shows a Stop verdict in the permission dialog and records the user's decision", async () => {
    const { run, host, reviewedHost, stats } = setup({ response: STOP });
    host.requestPermission.mockResolvedValueOnce("deny");
    expect(await run("git", ["push", "--force"])).toEqual({ ok: false, error: "Command denied by the user." });
    expect(host.requestPermission.mock.calls[0][0].description).toMatch(/^The agent wants to run: git push --force\n\nAutomated review \(JEV\): Stop at 80% confidence\. It is a destructive command/);
    expect(stats.getEntries()[0]).toMatchObject({ verdict: "stop", outcome: "user_blocked" });

    // The note applies once: the next dialog for the same command is plain unless reviewed again.
    await reviewedHost.requestPermission({ command: { program: "git", args: ["push", "--force"], cwd: "/ws", timeoutMs: 300_000 }, description: "plain" } as CommandPermissionRequest, new AbortController().signal);
    expect(host.requestPermission.mock.calls[1][0].description).toBe("plain");
  });
});
