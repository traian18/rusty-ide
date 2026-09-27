import { describe, expect, it, vi } from "vitest";
import type { ToolExecutionObserver } from "../../contract";
import type { SearchMatch } from "../../../services/searchService";
import type { CustomProvider } from "../../../store/types";
import type { SelectorModelInvoker } from "../semanticRead/modelInvoker";
import { globToRegExp, semanticSearch, validateQueries, type SemanticSearchOptions } from "./semanticSearch";

const ROOT = "/ws";

function match(path: string, line: number, content = `line ${line}`): SearchMatch {
  return { path: `${ROOT}/${path}`, name: path.split("/").pop()!, line, content, is_content_match: true };
}

function selectorReturning(queries: unknown, usage?: unknown): SelectorModelInvoker {
  return {
    invoke: vi.fn(async (request) => {
      if (usage) request.onUsage?.(usage);
      return JSON.stringify({ queries });
    }),
  };
}

function options(overrides: Partial<SemanticSearchOptions> & Pick<SemanticSearchOptions, "invoker" | "search">): SemanticSearchOptions {
  return {
    workspaceRoot: ROOT,
    request: "where auth failures become user-facing errors",
    selector: { providerId: "p", modelId: "selector-model", provider: { id: "p", name: "P" } as CustomProvider },
    signal: new AbortController().signal,
    ...overrides,
  };
}

function resultLines(output: string): string[] {
  return output.split("\n").filter((line) => / \| /.test(line));
}

describe("validateQueries", () => {
  it("accepts patterns, defaults regex to false, and drops case-insensitive duplicates", () => {
    expect(validateQueries({ queries: [{ pattern: "AuthError" }, { pattern: "autherror" }, { pattern: "auth(entication)?Failed", regex: true }] })).toEqual([
      { pattern: "AuthError", regex: false, reason: undefined },
      { pattern: "auth(entication)?Failed", regex: true, reason: undefined },
    ]);
  });

  it.each([
    [{}, "queries array"],
    [{ queries: [] }, "did not return any"],
    [{ queries: Array.from({ length: 7 }, (_, i) => ({ pattern: `p${i}` })) }, "too many"],
    [{ queries: [{ pattern: "  " }] }, "non-empty"],
    [{ queries: [{ pattern: "x".repeat(201) }] }, "exceeds"],
  ])("rejects %j", (value, message) => {
    expect(() => validateQueries(value)).toThrow(message);
  });
});

describe("globToRegExp", () => {
  it.each([
    ["*.ts", "a.ts", true],
    ["*.ts", "a.tsx", false],
    ["src/**/*.rs", "src/a.rs", true],
    ["src/**/*.rs", "src/x/y/a.rs", true],
    ["src/**/*.rs", "lib/a.rs", false],
    ["*.{ts,tsx}", "a.tsx", true],
    ["file?.md", "file1.md", true],
  ])("%s against %s -> %s", (glob, path, expected) => {
    expect(globToRegExp(glob).test(path)).toBe(expected);
  });
});

describe("semanticSearch", () => {
  it("ranks lines hit by more patterns first, then by the more specific pattern", async () => {
    const byPattern: Record<string, SearchMatch[]> = {
      AuthError: [match("src/b.ts", 9), match("src/a.ts", 3)],
      toUserMessage: [match("src/a.ts", 3), match("src/c.ts", 1)],
    };
    const output = await semanticSearch(options({
      invoker: selectorReturning([{ pattern: "AuthError" }, { pattern: "toUserMessage" }]),
      search: async (pattern) => byPattern[pattern] ?? [],
    }));

    expect(resultLines(output).map((line) => line.split(" | ")[0])).toEqual(["src/a.ts:3", "src/b.ts:9", "src/c.ts:1"]);
    expect(output).toContain("Showing 3 of 3 relevant matches");
  });

  it("applies path scope and include glob, ignores filename-only matches, and returns workspace-relative paths", async () => {
    const output = await semanticSearch(options({
      path: "src/",
      include: "*.ts",
      invoker: selectorReturning([{ pattern: "login" }]),
      search: async () => [
        match("src/auth/login.ts", 4),
        match("src/auth/login.rs", 4),
        match("test/login.ts", 2),
        { ...match("src/login.ts", 0), is_content_match: false },
      ],
    }));

    expect(resultLines(output).map((line) => line.split(" | ")[0])).toEqual(["src/auth/login.ts:4"]);
    expect(output).not.toContain(ROOT);
  });

  it("caps results per file and by max_results", async () => {
    const many = Array.from({ length: 20 }, (_, i) => match("src/noisy.ts", i + 1));
    const others = Array.from({ length: 10 }, (_, i) => match(`src/f${i}.ts`, 1));
    const search = async () => [...many, ...others];
    const invoker = selectorReturning([{ pattern: "x" }]);

    const all = resultLines(await semanticSearch(options({ invoker, search })));
    expect(all).toHaveLength(15);
    expect(all.filter((line) => line.startsWith("src/noisy.ts:"))).toHaveLength(5);

    const capped = await semanticSearch(options({ maxResults: 8, invoker, search }));
    expect(resultLines(capped)).toHaveLength(8);
    expect(capped).toContain("Showing 8 of 15 relevant matches");
  });

  it("keeps the output under its byte limit", async () => {
    const long = Array.from({ length: 50 }, (_, i) => match(`src/${"deep/".repeat(40)}f${i}.ts`, 1, "y".repeat(500)));
    const output = await semanticSearch(options({ maxResults: 50, invoker: selectorReturning([{ pattern: "y" }]), search: async () => long }));
    expect(output.length).toBeLessThanOrEqual(12_000);
  });

  it("reports patterns, per-pattern counts, ranking, and selector usage to the observer but not to the model", async () => {
    const observer: ToolExecutionObserver = { executedBy: vi.fn(), usage: vi.fn(), step: vi.fn() };
    const output = await semanticSearch(options({
      observer,
      invoker: selectorReturning([{ pattern: "AuthError", reason: "error type" }], { input_tokens: 40, output_tokens: 8 }),
      search: async () => [match("src/a.ts", 1)],
    }));

    expect(observer.usage).toHaveBeenCalledWith({ input_tokens: 40, output_tokens: 8 });
    const steps = vi.mocked(observer.step).mock.calls.map(([, message]) => message);
    expect(steps).toEqual(["pattern generation started", "search patterns generated", "pattern searched", "results ranked"]);
    expect(output).not.toContain("selector-model");
    expect(output).not.toContain("AuthError");
  });

  it("explains an empty result instead of failing", async () => {
    const output = await semanticSearch(options({ invoker: selectorReturning([{ pattern: "nothing" }]), search: async () => [] }));
    expect(output).toContain("No relevant matches found");
  });

  it("fails on invalid selector output without searching", async () => {
    const search = vi.fn(async () => []);
    await expect(semanticSearch(options({ invoker: { invoke: async () => "sorry" }, search }))).rejects.toThrow("invalid JSON");
    expect(search).not.toHaveBeenCalled();
  });

  it("stops before searching once cancelled", async () => {
    const controller = new AbortController();
    const search = vi.fn(async () => []);
    const invoker: SelectorModelInvoker = {
      invoke: async () => {
        controller.abort();
        return JSON.stringify({ queries: [{ pattern: "a" }] });
      },
    };
    await expect(semanticSearch(options({ invoker, search, signal: controller.signal }))).rejects.toThrow();
    expect(search).not.toHaveBeenCalled();
  });
});
