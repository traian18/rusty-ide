import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const script = fileURLToPath(new URL("./move-module.mjs", import.meta.url));

function project(files) {
  const root = mkdtempSync(join(tmpdir(), "move-module-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function run(root, args) {
  return spawnSync(process.execPath, [script, ...args, "--root", root], { encoding: "utf8" });
}

function move(root, args) {
  const result = run(root, args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

const read = (root, path) => readFileSync(join(root, path), "utf8");

describe("move-module", () => {
  it("moves a file and rewrites the imports that point at it", () => {
    const root = project({
      "src/a/x.ts": 'import { y } from "../b/y";\n',
      "src/b/y.ts": "export const y = 1;\n",
    });

    move(root, ["src/b/y.ts", "src/lib/y.ts"]);

    assert.equal(read(root, "src/a/x.ts"), 'import { y } from "../lib/y";\n');
    assert.ok(existsSync(join(root, "src/lib/y.ts")));
    assert.ok(!existsSync(join(root, "src/b")), "the emptied folder is removed");
  });

  it("moves a folder and keeps its internal imports while rewriting external ones", () => {
    const root = project({
      "src/a/index.ts": 'export * from "./x";\n',
      "src/a/x.ts": 'import "../b/y";\n',
      "src/b/y.ts": "export {};\n",
      "src/c/z.ts": 'import { x } from "../a/x";\nimport { a } from "../a";\n',
    });

    move(root, ["src/a", "src/feat/a"]);

    assert.equal(read(root, "src/feat/a/index.ts"), 'export * from "./x";\n');
    assert.equal(read(root, "src/feat/a/x.ts"), 'import "../../b/y";\n');
    assert.equal(
      read(root, "src/c/z.ts"),
      'import { x } from "../feat/a/x";\nimport { a } from "../feat/a";\n',
    );
  });

  it("rewrites the imports of a file that moves when its target stays put", () => {
    const root = project({
      "src/a/x.ts": "export {};\n",
      "src/c/z.ts": 'import { x } from "../a/x";\n',
    });

    move(root, ["src/c/z.ts", "src/c/deep/z.ts"]);

    assert.equal(read(root, "src/c/deep/z.ts"), 'import { x } from "../../a/x";\n');
  });

  it("keeps the file extension of a stylesheet import", () => {
    const root = project({
      "src/a/x.ts": 'import styles from "./x.module.css";\n',
      "src/a/x.module.css": ".a {}\n",
    });

    move(root, ["src/a/x.module.css", "src/a/styles/x.module.css"]);

    assert.equal(read(root, "src/a/x.ts"), 'import styles from "./styles/x.module.css";\n');
  });

  it("rewrites vi.mock, vi.importActual and dynamic imports, keeping raw query suffixes", () => {
    const root = project({
      "src/a/x.ts": "export const x = 1;\n",
      "src/a/raw.ts": 'import text from "./x.ts?raw";\n',
      "src/c/z.test.ts": [
        'vi.mock("../a/x", () => ({}));',
        'const actual = await vi.importActual("../a/x");',
        'const late = await import("../a/x");',
        'import "../a/x";',
        "",
      ].join("\n"),
    });

    move(root, ["src/a/x.ts", "src/a/core/x.ts"]);

    const test = read(root, "src/c/z.test.ts");
    assert.equal(test.match(/"\.\.\/a\/core\/x"/g)?.length, 4);
    assert.equal(read(root, "src/a/raw.ts"), 'import text from "./core/x.ts?raw";\n');
  });

  it("leaves package imports and unresolved paths alone", () => {
    const root = project({
      "src/a/x.ts": 'import react from "react";\nimport missing from "./nowhere";\n',
      "src/b/y.ts": "export {};\n",
    });

    move(root, ["src/b/y.ts", "src/c/y.ts"]);

    assert.equal(read(root, "src/a/x.ts"), 'import react from "react";\nimport missing from "./nowhere";\n');
  });

  it("writes nothing on --dry-run and prints the planned moves", () => {
    const root = project({
      "src/a/x.ts": 'import { y } from "../b/y";\n',
      "src/b/y.ts": "export {};\n",
    });

    const result = spawnSync(process.execPath, [script, "src/b/y.ts", "src/lib/y.ts", "--dry-run", "--root", root], {
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /move src\/b\/y\.ts -> src\/lib\/y\.ts/);
    assert.match(result.stdout, /"\.\.\/b\/y" -> "\.\.\/lib\/y"/);
    assert.equal(read(root, "src/a/x.ts"), 'import { y } from "../b/y";\n');
    assert.ok(existsSync(join(root, "src/b/y.ts")));
  });

  it("flags files that use import.meta.glob for a manual check", () => {
    const root = project({
      "src/a/index.ts": 'const modules = import.meta.glob("./*.ts");\n',
      "src/a/x.ts": "export {};\n",
    });

    const output = move(root, ["src/a/x.ts", "src/a/core/x.ts"]);

    assert.doesNotMatch(output, /check by hand: src\/a\/index\.ts/);
    const moved = move(root, ["src/a", "src/feat/a"]);
    assert.match(moved, /check by hand: src\/feat\/a\/index\.ts uses import\.meta\.glob/);
  });

  it("refuses to overwrite an existing destination", () => {
    const root = project({
      "src/a/x.ts": "export {};\n",
      "src/b/x.ts": "export {};\n",
    });

    const result = run(root, ["src/a/x.ts", "src/b/x.ts"]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /destination already exists: src\/b\/x\.ts/);
    assert.ok(existsSync(join(root, "src/a/x.ts")));
  });

  it("refuses paths outside src", () => {
    const root = project({ "src/a/x.ts": "export {};\n" });

    const result = run(root, ["src/a/x.ts", "lib/x.ts"]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /paths must be under src\//);
  });
});
