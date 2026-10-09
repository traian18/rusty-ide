import { describe, expect, it } from "vitest";
import { compactionRecipe, contextWindowOf } from "./contextCompaction";

const provider = { models: [{ id: "p/m", remoteId: "m", name: "M", contextWindow: 200_000 }, { id: "p/none", name: "N" }] };

describe("contextWindowOf", () => {
  it("matches by id or remote id and ignores unknown windows", () => {
    expect(contextWindowOf(provider, "p/m")).toBe(200_000);
    expect(contextWindowOf(provider, "m")).toBe(200_000);
    expect(contextWindowOf(provider, "p/none")).toBeUndefined();
    expect(contextWindowOf(undefined, "m")).toBeUndefined();
  });
  it("matches UI references with a provider prefix or a reasoning variant", () => {
    const prefixed = { id: "p", models: [{ id: "p/m", remoteId: "m", name: "M", contextWindow: 200_000 }] };
    expect(contextWindowOf(prefixed, "p/m::reasoning=high")).toBe(200_000);
    expect(contextWindowOf(prefixed, "m::reasoning=low")).toBe(200_000);
  });
});

describe("compactionRecipe", () => {
  it("is absent without a snapshot", () => {
    expect(compactionRecipe(undefined, provider, "m")).toBeUndefined();
  });
  it("standard mode carries only the window", () => {
    expect(compactionRecipe({ mode: "standard" }, provider, "m")).toEqual({ mode: "standard", context_window: 200_000 });
  });
  it("smart mode carries the JEV connection", () => {
    expect(compactionRecipe({ mode: "smart", jev: { apiKey: "k", jevModelId: "jev-1", confidence: 0.7 } }, provider, "p/none")).toEqual({
      mode: "smart",
      jev: { api_key: "k", model_id: "jev-1", confidence: 0.7 },
    });
  });
});

import { historyBudgetChars } from "./contextCompaction";
import { flattenHistory } from "./definitions/promptHistory";

describe("historyBudgetChars", () => {
  it("is 40% of the window in characters, and absent when the window is unknown", () => {
    expect(historyBudgetChars(provider, "m")).toBe(320_000);
    expect(historyBudgetChars(provider, "p/none")).toBeUndefined();
  });
});

describe("flattenHistory with a budget", () => {
  const turn = (role: "user" | "assistant", content: string, pinned = false) => ({ role, content, ...(pinned ? { pinned } : {}) });
  const history = [
    turn("user", "original task"),
    turn("assistant", "x".repeat(100)),
    turn("user", "PINNED DECISION", true),
    turn("assistant", "y".repeat(100)),
    turn("user", "latest question"),
  ];

  it("keeps everything without a budget or under it", () => {
    expect(flattenHistory(history)).not.toContain("omitted");
    expect(flattenHistory(history, { budgetChars: 10_000 })).not.toContain("omitted");
  });

  it("keeps pinned turns, the opening request and the latest turn when trimming", () => {
    const text = flattenHistory(history, { budgetChars: 60 });
    expect(text).toContain("original task");
    expect(text).toContain("PINNED DECISION");
    expect(text).toContain("latest question");
    expect(text).not.toContain("xxxx");
    expect(text).not.toContain("yyyy");
    expect(text).toContain("[… 1 earlier message omitted to save context]");
  });

  it("fills the remaining budget with the newest turns", () => {
    const text = flattenHistory(history, { budgetChars: 150 });
    expect(text).toContain("yyyy");
    expect(text).not.toContain("xxxx");
  });
});

import { isContextSummaryRequest } from "./contextCompaction";

describe("isContextSummaryRequest", () => {
  it("recognizes rusty-core's tagged summary requests only", () => {
    const request = (provider_options?: unknown) => ({ params: { provider_options } }) as never;
    expect(isContextSummaryRequest(request({ rusty: { purpose: "context_summary" } }))).toBe(true);
    expect(isContextSummaryRequest(request({ rusty: { trace_model_requests: true } }))).toBe(false);
    expect(isContextSummaryRequest(request(undefined))).toBe(false);
  });
});
