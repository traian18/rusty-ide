import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("harness module boundaries", () => {
  // The store's slices import the harness (e.g. createMetricsSlice), so a
  // runtime import of the store from harness code creates a module cycle.
  // Run inputs carry whatever store state a run needs instead (see
  // store/smartToolSettingsSnapshot.ts); leaf helpers under store/ are fine.
  it("never imports the workspace store at runtime", () => {
    const root = join(__dirname);
    const offenders = sourceFiles(root).filter((file) => {
      const source = readFileSync(file, "utf8");
      return /^import\s+(?!type\b)[^;]*from\s+["'](?:\.\.\/)+store(?:\/index)?["']/m.test(source);
    });
    expect(offenders.map((file) => relative(root, file))).toEqual([]);
  });
});
