import { afterEach, describe, expect, it, vi } from "vitest";

import type { CustomProvider, ProviderModel } from "../store/types";
import {
  buildIntelligentCandidates,
  findOpenRouterJevModels,
  findOpenRouterJevProvider,
  isJevDecisionModelId,
  resolveAutoLevel,
  resolveLevelCandidates,
  resolveOpenRouterJevModel,
  selectIntelligentModel,
  type IntelligentCandidate,
  type LevelCandidates,
} from "./intelligentModelSelector";

function model(remoteId: string, overrides: Partial<ProviderModel> = {}): ProviderModel {
  return {
    id: `openrouter/${remoteId}`,
    remoteId,
    name: remoteId,
    supported: true,
    ...overrides,
  };
}

function openRouter(models: ProviderModel[], apiKey = "or-test-key"): CustomProvider {
  return {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey,
    apiType: "openai-completions",
    authType: "bearer",
    models,
  };
}

describe("OpenRouter JEV model discovery", () => {
  it("finds every Decisions API version and alias even when normal chat support is false", () => {
    const provider = openRouter([
      model("typesafe/jev-router", { name: "TypeSafe: Jev Router" }),
      model("typesafe/jev-1.13", { name: "TypeSafe: Jev 1.13", supported: false }),
      model("typesafe/jev-1.14", { name: "TypeSafe: Jev 1.14", supported: false }),
      model("~typesafe/jev-latest", { name: "TypeSafe: Jev Latest", supported: false }),
      model("anthropic/claude-sonnet-4", { name: "Claude Sonnet 4" }),
    ]);

    expect(findOpenRouterJevModels(provider).map((entry) => entry.remoteId)).toEqual([
      "~typesafe/jev-latest",
      "typesafe/jev-1.14",
      "typesafe/jev-1.13",
    ]);
    expect(findOpenRouterJevProvider([provider])).toBe(provider);
    expect(resolveOpenRouterJevModel(provider)?.remoteId).toBe("~typesafe/jev-latest");
    expect(resolveOpenRouterJevModel(provider, "typesafe/jev-1.13")?.remoteId).toBe("typesafe/jev-1.13");
  });

  it("does not mistake Jev Router for a Decisions API model", () => {
    const provider = openRouter([model("typesafe/jev-router")]);

    expect(isJevDecisionModelId("typesafe/jev-router")).toBe(false);
    expect(findOpenRouterJevModels(provider)).toEqual([]);
    expect(findOpenRouterJevProvider([provider])).toBeUndefined();
  });

  it("keeps all JEV family entries out of executable AUTO candidates", () => {
    const provider = openRouter([
      model("typesafe/jev-router"),
      model("typesafe/jev-1.13", { supported: false }),
      model("~typesafe/jev-latest", { supported: false }),
      model("openai/gpt-4.1", { name: "GPT-4.1" }),
    ]);

    const candidates = buildIntelligentCandidates([provider], {}, "openrouter");

    expect(candidates.map((candidate) => candidate.model.remoteId)).toEqual(["openai/gpt-4.1"]);
  });
});

describe("resolveLevelCandidates", () => {
  it("maps each level to its model and reports levels whose model is unset or gone", () => {
    const provider = openRouter([
      model("openai/gpt-4.1"),
      model("anthropic/claude-sonnet-4"),
      model("typesafe/jev-router"),
    ]);

    const { candidates, missing } = resolveLevelCandidates([provider], {}, "openrouter", {
      light: "openrouter:openrouter/openai/gpt-4.1",
      standard: "openrouter:openrouter/removed/model",
      heavy: null,
    });

    expect(candidates.light?.model.remoteId).toBe("openai/gpt-4.1");
    expect(missing).toEqual(["standard", "heavy"]);
  });

  it("never offers the JEV router as a level's model", () => {
    const provider = openRouter([model("typesafe/jev-router")]);

    const { missing } = resolveLevelCandidates([provider], {}, "openrouter", {
      light: "openrouter:openrouter/typesafe/jev-router",
      standard: "openrouter:openrouter/typesafe/jev-router",
      heavy: "openrouter:openrouter/typesafe/jev-router",
    });

    expect(missing).toEqual(["light", "standard", "heavy"]);
  });
});

describe("resolveAutoLevel", () => {
  it("uses JEV's most likely level when it is confident", () => {
    expect(resolveAutoLevel({ light: 0.85, standard: 0.12, heavy: 0.03 }, 0.78))
      .toEqual({ level: "light", jevLevel: "light", escalated: false });
  });

  it("steps up one level when unsure and the runner-up is higher", () => {
    expect(resolveAutoLevel({ light: 0.5, standard: 0.4, heavy: 0.1 }, 0.25))
      .toEqual({ level: "standard", jevLevel: "light", escalated: true });
    // Even when the runner-up is two levels up, AUTO climbs only one.
    expect(resolveAutoLevel({ light: 0.5, standard: 0.1, heavy: 0.4 }, 0.25))
      .toEqual({ level: "standard", jevLevel: "light", escalated: true });
  });

  it("stays put when unsure but the runner-up is lower, or it is already Heavy", () => {
    expect(resolveAutoLevel({ light: 0.4, standard: 0.5, heavy: 0.1 }, 0.25))
      .toEqual({ level: "standard", jevLevel: "standard", escalated: false });
    expect(resolveAutoLevel({ light: 0.1, standard: 0.4, heavy: 0.5 }, 0.25))
      .toEqual({ level: "heavy", jevLevel: "heavy", escalated: false });
  });
});

function levelCandidates(provider: CustomProvider): LevelCandidates {
  const candidate = (name: string): IntelligentCandidate => ({
    id: `${provider.id}:${name}`,
    provider,
    model: { id: name, name, supported: true },
  });
  return { light: candidate("small"), standard: candidate("medium"), heavy: candidate("large") };
}

function scoreResponse(probabilities: Record<string, number>, confidence: number): Response {
  return new Response(JSON.stringify({
    answers: { level: { type: "score", score: 0.4, confidence, probabilities } },
    usage: { cost: 0.00006 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("selectIntelligentModel", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("asks the selected JEV version to score the request, without naming any model", async () => {
    const provider = openRouter([
      model("typesafe/jev-1.13", { supported: false }),
      model("typesafe/jev-1.14", { supported: false }),
    ]);
    const levels = levelCandidates(provider);
    let sentBody: any;
    globalThis.fetch = vi.fn(async (input, init) => {
      expect(String(input)).toBe("https://openrouter.ai/api/alpha/decisions");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer or-test-key");
      sentBody = JSON.parse(String(init?.body));
      return scoreResponse({ "0": 0.9, "1": 0.08, "2": 0.02 }, 0.85);
    }) as typeof fetch;

    await expect(selectIntelligentModel("What is a closure?", provider, levels, "typesafe/jev-1.14"))
      .resolves.toMatchObject({ level: "light", escalated: false, candidate: levels.light, confidence: 0.85, jevModelId: "typesafe/jev-1.14" });

    expect(sentBody.model).toBe("typesafe/jev-1.14");
    expect(sentBody.questions.level.type).toBe("score");
    expect(sentBody.questions.level.criteria).toHaveLength(3);
    expect(sentBody.questions.level.criteria[0]).toMatch(/^Light:/);
    expect(sentBody.state).toContain("What is a closure?");
    expect(JSON.stringify(sentBody)).not.toContain("medium");
  });

  it("steps up one level when JEV is unsure, and reports the full exchange", async () => {
    const provider = openRouter([model("typesafe/jev-1.13", { supported: false })]);
    const levels = levelCandidates(provider);
    globalThis.fetch = vi.fn(async () => scoreResponse({ "0": 0.55, "1": 0.4, "2": 0.05 }, 0.3)) as typeof fetch;
    const onTrace = vi.fn();

    await expect(selectIntelligentModel("Fix the flaky login test", provider, levels, null, onTrace))
      .resolves.toMatchObject({ level: "standard", escalated: true, candidate: levels.standard });

    expect(onTrace).toHaveBeenCalledTimes(1);
    expect(onTrace.mock.calls[0][0]).toMatchObject({
      outcome: "selected",
      httpStatus: 200,
      jevLevel: "light",
      level: "standard",
      escalated: true,
      confidence: 0.3,
      probabilities: { light: 0.55, standard: 0.4, heavy: 0.05 },
      selectedModel: "openrouter:medium",
      cost: 0.00006,
    });
  });

  it("reports a failed exchange with the provider's response body", async () => {
    const provider = openRouter([model("typesafe/jev-1.13", { supported: false })]);
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 })) as typeof fetch;
    const onTrace = vi.fn();

    await expect(selectIntelligentModel("Hi", provider, levelCandidates(provider), null, onTrace))
      .rejects.toThrow("OpenRouter JEV selection failed (400).");
    expect(onTrace.mock.calls[0][0]).toMatchObject({
      outcome: "failed",
      httpStatus: 400,
      response: { error: { message: "bad request" } },
    });
  });
});
