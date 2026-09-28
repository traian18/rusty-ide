import { describe, expect, it } from "vitest";
import type { CustomProvider } from "../../../store/types";
import type { DecideStepUpConfig } from "../decideToolConfig";
import { assessLevel, levelQuestion, stepUpTargets, type StepUpTarget } from "./decideStepUp";

const PROVIDER = { id: "p1", name: "Anthropic", baseUrl: "https://api.anthropic.com", apiKey: "sk-test", apiType: "anthropic-messages", models: [] } as unknown as CustomProvider;

const config = (levels: DecideStepUpConfig["levels"]): DecideStepUpConfig => ({ level: "light", levels });

function scoreAnswer(probabilities: [number, number, number], confidence: number) {
  return { type: "score", confidence, probabilities: { "0": probabilities[0], "1": probabilities[1], "2": probabilities[2] } };
}

describe("stepUpTargets", () => {
  it("offers the higher levels whose models the session can switch to in place", () => {
    const targets = stepUpTargets(config({
      light: { providerId: "p1", model: "claude-haiku-4-5", name: "Haiku" },
      standard: { providerId: "p1", model: "claude-sonnet-4-5", name: "Sonnet" },
      heavy: { providerId: "p1", model: "claude-opus-4-1::reasoning=high", name: "Opus (high)" },
    }), "light", PROVIDER, "claude-haiku-4-5");

    expect(targets).toEqual([
      { level: "standard", name: "Sonnet", model: "claude-sonnet-4-5", params: { model: "claude-sonnet-4-5" } },
      { level: "heavy", name: "Opus (high)", model: "claude-opus-4-1::reasoning=high", params: { model: "claude-opus-4-1::reasoning=high", reasoning_effort: "high" } },
    ]);
    expect(stepUpTargets(config({ heavy: { providerId: "p1", model: "claude-opus-4-1", name: "Opus" } }), "heavy", PROVIDER, "claude-opus-4-1")).toEqual([]);
  });

  it("skips models on another provider, the current model, and models that would inherit a reasoning effort", () => {
    const targets = stepUpTargets(config({
      standard: { providerId: "other", model: "gpt-5", name: "GPT-5" },
      heavy: { providerId: "p1", model: "claude-sonnet-4-5::reasoning=low", name: "Sonnet" },
    }), "light", PROVIDER, "claude-sonnet-4-5::reasoning=low");
    expect(targets).toEqual([]);

    const noEffort = stepUpTargets(config({ heavy: { providerId: "p1", model: "claude-opus-4-1", name: "Opus" } }), "light", PROVIDER, "claude-haiku-4-5::reasoning=low");
    expect(noEffort).toEqual([]);
  });

  it("never switches a managed transport, whose model runs inside its own CLI", () => {
    const managed = { ...PROVIDER, transport: "openai-codex-app-server" } as CustomProvider;
    expect(stepUpTargets(config({ heavy: { providerId: "p1", model: "gpt-5", name: "GPT-5" } }), "light", managed, "gpt-5-mini")).toEqual([]);
    expect(stepUpTargets(config({ heavy: { providerId: "p1", model: "gpt-5", name: "GPT-5" } }), "light", undefined, "gpt-5-mini")).toEqual([]);
  });
});

describe("assessLevel", () => {
  const standard: StepUpTarget = { level: "standard", name: "Sonnet", model: "s", params: { model: "s" } };
  const heavy: StepUpTarget = { level: "heavy", name: "Opus", model: "o", params: { model: "o" } };

  it("steps up to the most capable target at or below JEV's level when it is confident", () => {
    expect(assessLevel(scoreAnswer([0.05, 0.1, 0.85], 0.8), "light", [standard, heavy], 0.6)).toEqual({ level: "heavy", confidence: 0.8, target: heavy });
    expect(assessLevel(scoreAnswer([0.05, 0.85, 0.1], 0.8), "light", [standard, heavy], 0.6)?.target).toBe(standard);
    // Heavy work, but only Standard is reachable on this provider: still better than staying.
    expect(assessLevel(scoreAnswer([0.05, 0.1, 0.85], 0.8), "light", [standard], 0.6)?.target).toBe(standard);
  });

  it("stays when JEV is unsure, or rates the remaining work at or below the current level", () => {
    expect(assessLevel(scoreAnswer([0.1, 0.4, 0.5], 0.4), "light", [standard, heavy], 0.6)).toEqual({ level: "heavy", confidence: 0.4 });
    expect(assessLevel(scoreAnswer([0.1, 0.85, 0.05], 0.8), "standard", [heavy], 0.6)?.target).toBeUndefined();
    expect(assessLevel(scoreAnswer([0.85, 0.1, 0.05], 0.8), "standard", [heavy], 0.6)?.target).toBeUndefined();
    expect(assessLevel(undefined, "light", [heavy], 0.6)).toBeUndefined();
  });

  it("asks AUTO's rubric, lowest level first, about the remaining work", () => {
    const question = levelQuestion();
    expect(question.type).toBe("score");
    expect(question.criteria).toHaveLength(3);
    expect(question.criteria[0]).toMatch(/^Light: /);
    expect(question.instructions).toMatch(/rest of this request/);
  });
});
