import { describe, expect, it, vi } from "vitest";

vi.mock("../../harness/HybridControlPlane", () => ({ hybridControlPlane: { recordUsage: vi.fn().mockResolvedValue(undefined) } }));

import { goalReviewer, parseReview, reviewPrompt, type PassEvidence } from "./goalReview";
import type { CustomProvider } from "../../store/types";

const evidence: PassEvidence = {
  instruction: "Finish the security work",
  plan: [{ content: "Session revocation", status: "cancelled" }, { content: "Remove debug logging", status: "completed" }],
  checks: [{ name: "build", passed: true, ran: true, summary: "PASSED" }],
  modifiedFiles: ["src/a.js"],
  diff: "-console.log(x)",
  response: "Status: blocked — cannot be patched in isolation",
};

describe("goal pass reviewer", () => {
  it("shows the plan, checks, files and diff, and marks the agent's message as a claim", () => {
    const prompt = reviewPrompt(evidence);
    expect(prompt).toContain("<goal>\nFinish the security work\n</goal>");
    expect(prompt).toContain("- [cancelled] Session revocation");
    expect(prompt).toContain("- build: passed — PASSED");
    expect(prompt).toContain("```diff\n-console.log(x)\n```");
    expect(prompt).toContain("final message (a claim, not evidence)");
    expect(reviewPrompt({ ...evidence, diff: "", plan: [], checks: [], modifiedFiles: [] })).toContain("(no changes)");
  });

  it("reads the one-line verdict and ignores anything unusable", () => {
    expect(parseReview('{"verdict":"continue","reason":"rotation is two calls","next_step":"make it one script"}'))
      .toEqual({ verdict: "continue", reason: "rotation is two calls", next_step: "make it one script" });
    expect(parseReview('Here: {"verdict":"blocked","reason":"needs the origin"}')).toEqual({ verdict: "blocked", reason: "needs the origin" });
    expect(parseReview('{"verdict":"maybe","reason":"x"}')).toBeUndefined();
    expect(parseReview('{"verdict":"done","reason":""}')).toBeUndefined();
    expect(parseReview("not json")).toBeUndefined();
  });

  it("asks the chat's model once, and gives nothing when the call fails", async () => {
    const invoke = vi.fn().mockResolvedValue('{"verdict":"continue","reason":"r","next_step":"s"}');
    const provider = { id: "codex" } as CustomProvider;
    const review = goalReviewer({ provider, model: "gpt-6.1-terra", workspaceRoot: "/ws", tabId: "t", invoker: { invoke } });
    expect(await review(evidence)).toEqual({ verdict: "continue", reason: "r", next_step: "s" });
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ providerId: "codex", modelId: "gpt-6.1-terra", systemPrompt: expect.stringContaining("not a blocker") }));
    invoke.mockRejectedValue(new Error("offline"));
    expect(await review(evidence)).toBeUndefined();
  });
});
