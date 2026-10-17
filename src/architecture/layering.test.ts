import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Modules that must stay free of React, the app store, and Tauri so they remain unit-testable. */
const PURE = ["model", "identity", "layout", "freshness", "persistence", "navigation", "graphModel", "aggregate", "levels", "levelGraph", "layoutElk"];
const FORBIDDEN = [/from\s+["']react["']/, /from\s+["']react-dom/, /from\s+["']@tauri-apps/, /from\s+["']\.\.\/store/, /from\s+["']@xyflow/];

describe("architecture layering", () => {
  const dir = __dirname;
  const present = readdirSync(dir);

  for (const name of PURE) {
    it(`${name} imports no React, store, or Tauri`, () => {
      if (!present.includes(`${name}.ts`)) return;
      const source = readFileSync(join(dir, `${name}.ts`), "utf8");
      for (const pattern of FORBIDDEN) expect(source).not.toMatch(pattern);
    });
  }

  it("only client.ts talks to Tauri", () => {
    const offenders = present
      .filter((file) => /\.(ts|tsx)$/.test(file) && !file.endsWith(".test.ts") && !file.endsWith(".test.tsx") && file !== "client.ts")
      .filter((file) => /@tauri-apps/.test(readFileSync(join(dir, file), "utf8")));
    expect(offenders).toEqual([]);
  });
});
