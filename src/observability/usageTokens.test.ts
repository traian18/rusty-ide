import { describe, expect, it } from "vitest";

import { addTokens, definedTokens, parseUsageTokens } from "./usageTokens";

describe("parseUsageTokens", () => {
  it("reads rusty-core snake_case usage inside its metrics wrapper", () => {
    expect(parseUsageTokens({ model: "m", metrics: { total_tokens: 30, input_tokens: 20, output_tokens: 10, reasoning_tokens: 4 } }))
      .toEqual({ totalTokens: 30, inputTokens: 20, outputTokens: 10, cacheReadTokens: undefined, cacheWriteTokens: undefined, reasoningTokens: 4 });
  });

  it("reads the IDE's camelCase and short field names", () => {
    expect(definedTokens(parseUsageTokens({ totalTokens: 7, cacheRead: 2, cacheWriteTokens: 1 })))
      .toEqual({ totalTokens: 7, cacheReadTokens: 2, cacheWriteTokens: 1 });
  });

  it("takes a count from a number, a tuple, or an object holding it at 0 or value", () => {
    expect(definedTokens(parseUsageTokens({ total: 5, input: [3, "x"], output: { value: 2 }, reasoning: { 0: 1 } })))
      .toEqual({ totalTokens: 5, inputTokens: 3, outputTokens: 2, reasoningTokens: 1 });
  });

  it("ignores NaN, strings, nulls and non-numeric holders", () => {
    expect(definedTokens(parseUsageTokens({ total: NaN, input: "3", output: null, cacheRead: ["3"], cacheWrite: { value: NaN }, reasoning: [] })))
      .toEqual({});
  });

  it("treats a missing or non-object usage as empty", () => {
    expect(definedTokens(parseUsageTokens(undefined))).toEqual({});
    expect(definedTokens(parseUsageTokens(42))).toEqual({});
  });
});

describe("addTokens", () => {
  it("sums only the fields the increment sets", () => {
    expect(addTokens({ totalTokens: 10, inputTokens: 4 }, { totalTokens: 5, outputTokens: 5 }))
      .toEqual({ totalTokens: 15, inputTokens: 4, outputTokens: 5 });
  });
});
