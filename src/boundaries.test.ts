import { describe, expect, it } from "vitest";
import {
  CROSS_FEATURE_DEEP_IMPORT,
  LAYERING,
  OVERSIZED,
  REACT_OUTSIDE_UI,
  TAURI_OUTSIDE_CLIENT,
} from "./boundaryAllowlist";
import {
  crossFeatureDeepImports,
  layeringBreaks,
  oversizedFiles,
  productionModules,
  reactOutsideUi,
  tauriOutsideClient,
} from "./test/boundaryRules";

// Every source file under src/, as raw text. The rules themselves are in test/boundaryRules.ts.
const sources: Record<string, string> = import.meta.glob("./**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
});
const modules = productionModules(sources);

/**
 * Compares a rule's findings with its allowlist in both directions. A finding that is not listed
 * is a new violation; a listed file that no longer breaks the rule must come off the list.
 */
function expectAllowlisted(found: readonly string[], allowed: readonly string[]) {
  expect({
    unlisted: found.filter((path) => !allowed.includes(path)),
    stale: allowed.filter((path) => !found.includes(path)),
  }).toEqual({ unlisted: [], stale: [] });
}

describe("module boundaries", () => {
  it("reads the whole source tree", () => {
    expect(modules.length).toBeGreaterThan(500);
  });

  it("calls Tauri only from clients and the harness (B1)", () => {
    expectAllowlisted(tauriOutsideClient(modules), TAURI_OUTSIDE_CLIENT);
  });

  it("reaches other features only through their index.ts (B2)", () => {
    expectAllowlisted(crossFeatureDeepImports(modules), CROSS_FEATURE_DEEP_IMPORT);
  });

  it("keeps lib/ below features and the harness free of views (B3)", () => {
    expectAllowlisted(layeringBreaks(modules), LAYERING);
  });

  it("keeps React and .tsx inside each feature's ui/ folder (B4)", () => {
    expectAllowlisted(reactOutsideUi(modules), REACT_OUTSIDE_UI);
  });

  it("keeps files within their size limits (B5)", () => {
    const recorded = new Map(OVERSIZED);
    const problems: string[] = [];
    const over = oversizedFiles(modules);

    for (const [path, lines] of over) {
      const recordedLines = recorded.get(path);
      if (recordedLines === undefined) problems.push(`${path}: ${lines} lines, over its limit`);
      else if (lines > recordedLines) problems.push(`${path}: grew to ${lines} lines, recorded ${recordedLines}`);
    }
    for (const [path] of OVERSIZED) {
      if (!over.some(([overPath]) => overPath === path)) {
        problems.push(`${path}: no longer over its limit, remove it from OVERSIZED`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("module boundary allowlists", () => {
  it("lists each file once", () => {
    const lists = [TAURI_OUTSIDE_CLIENT, CROSS_FEATURE_DEEP_IMPORT, LAYERING, REACT_OUTSIDE_UI];
    for (const list of lists) expect(new Set(list).size).toBe(list.length);
    expect(new Set(OVERSIZED.map(([path]) => path)).size).toBe(OVERSIZED.length);
  });
});
