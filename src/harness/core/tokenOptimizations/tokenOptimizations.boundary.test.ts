import { describe, expect, it } from "vitest";
import { importsOf, productionModules, resolveImport } from "../../../test/boundaryRules";

// The module's only public surface is its index.ts: everything outside the
// folder reaches it there, so internals can change without touching callers.
const sources: Record<string, string> = import.meta.glob("/src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });
const FOLDER = "harness/core/tokenOptimizations";

const modules = Object.entries(sources).map(([path, text]) => ({ path: path.replace(/^\/src\//, ""), text }));
const outside = modules.filter(({ path }) => !path.startsWith(`${FOLDER}/`));
const importsInto = ({ path, text }: { path: string; text: string }) =>
  importsOf(text).map(({ spec }) => resolveImport(path, spec)).filter((target): target is string => target !== undefined && (target === FOLDER || target.startsWith(`${FOLDER}/`)));

describe("tokenOptimizations boundary", () => {
  it("reads the source tree", () => {
    expect(productionModules(Object.fromEntries(modules.map(({ path, text }) => [path, text]))).length).toBeGreaterThan(500);
  });

  it("is imported from outside only through its index", () => {
    const deep = outside.flatMap((module) => importsInto(module).filter((target) => target !== FOLDER && target !== `${FOLDER}/index`).map((target) => `${module.path} -> ${target}`));
    expect(deep).toEqual([]);
  });

  it("is used by the command tools, job_output, the chat history, model switching and Settings", () => {
    const users = outside.filter((module) => importsInto(module).length > 0 && !/\.test\.tsx?$/.test(module.path)).map(({ path }) => path).sort();
    expect(users).toEqual(expect.arrayContaining([
      "harness/core/definitions/commandJobs.ts",
      "harness/core/definitions/runCommandTool.ts",
      "harness/core/definitions/promptHistory.ts",
      "harness/core/definitions/decideStepUp.ts",
      "harness/core/definitions/stepModelSelection.ts",
    ]));
    expect(users.some((path) => path.startsWith("features/settings/"))).toBe(true);
  });

  it("keeps its index free of React and the store, so the harness and Node tests can load it", () => {
    const index = modules.find(({ path }) => path === `${FOLDER}/index.ts`)!;
    expect(index.text).not.toMatch(/from "react"|from "(\.\.\/)+store(\/index)?"/);
  });
});
