#!/usr/bin/env node
// Moves files or folders under src/ and rewrites the relative imports that point at them,
// so a move never leaves a broken import behind.
//
//   node scripts/move-module.mjs <from> <to> [<from> <to> ...] [--dry-run] [--root <dir>]
//
// Paths are relative to the project root (the directory above scripts/). Moves use `git mv`,
// and fall back to a plain rename when the file is not tracked or the project is not a repository.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";

const SRC = "src";

// Matches a relative specifier in `from "…"`, `import "…"`, `import("…")`, `vi.mock("…")`
// and `vi.importActual("…")`. Package names are never matched, so they never move.
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bvi\.(?:mock|doMock|importActual|unmock)\(\s*)(["'])(\.\.?\/[^"'\n]*)\2/g;

const GLOB = /import\.meta\.glob\(/;

function normalize(path) {
  const clean = path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!clean.startsWith(`${SRC}/`)) throw new Error(`paths must be under ${SRC}/: ${path}`);
  return clean;
}

function parseArgs(argv) {
  const dryRun = argv.includes("--dry-run");
  const rootAt = argv.indexOf("--root");
  const root = rootAt === -1 ? process.cwd() : resolve(argv[rootAt + 1] ?? "");
  const skipped = new Set(rootAt === -1 ? [] : [rootAt, rootAt + 1]);
  const paths = argv.filter((arg, i) => !skipped.has(i) && arg !== "--dry-run");
  if (paths.length === 0 || paths.length % 2 !== 0) throw new Error("expected <from> <to> pairs");

  const pairs = [];
  for (let i = 0; i < paths.length; i += 2) pairs.push([normalize(paths[i]), normalize(paths[i + 1])]);
  return { dryRun, root, pairs };
}

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

const toRel = (root, abs) => relative(root, abs).split(sep).join("/");

// Maps every old path that moves to its new path. A folder moves all the files beneath it.
function buildMoves(root, pairs, files) {
  const moves = new Map();
  for (const [from, to] of pairs) {
    const abs = join(root, from);
    if (!existsSync(abs)) throw new Error(`no such path: ${from}`);
    if (statSync(abs).isDirectory()) {
      for (const file of files) {
        if (file.startsWith(`${from}/`)) moves.set(file, to + file.slice(from.length));
      }
    } else {
      moves.set(from, to);
    }
  }

  const targets = [...moves.values()];
  for (const target of targets) {
    if (existsSync(join(root, target))) throw new Error(`destination already exists: ${target}`);
  }
  if (new Set(targets).size !== targets.length) throw new Error("two files would move to the same place");
  return moves;
}

// Finds the file a relative specifier points at, using the same order as TypeScript and Vite.
function resolveTarget(known, importer, specifier) {
  const [, pathPart, query = ""] = specifier.match(/^([^?]*)(\?.*)?$/);
  const base = posix.normalize(posix.join(posix.dirname(importer), pathPart));
  const candidates = [base, `${base}.ts`, `${base}.tsx`, posix.join(base, "index.ts"), posix.join(base, "index.tsx")];
  const file = candidates.find((candidate) => known.has(candidate));
  return file === undefined ? undefined : { file, exact: file === base, pathPart, query };
}

// The specifier that reaches `target` from `importer`, keeping the file extension only when
// the original named one, and keeping a bare folder import when the original was a folder.
function newSpecifier(importer, target, { exact, pathPart }) {
  let rel = posix.relative(posix.dirname(importer), target);
  if (!exact) {
    rel = rel.replace(/\.tsx?$/, "");
    if (posix.basename(rel) === "index" && !pathPart.endsWith("index")) rel = posix.dirname(rel);
  }
  if (rel === ".") return "./";
  return rel.startsWith("../") ? rel : `./${rel}`;
}

function rewriteImports(content, importer, newImporter, moves, known) {
  const changes = [];
  const rewritten = content.replace(SPECIFIER, (whole, lead, quote, specifier) => {
    const found = resolveTarget(known, importer, specifier);
    if (!found) return whole;

    const target = moves.get(found.file) ?? found.file;
    const next = newSpecifier(newImporter, target, found) + found.query;
    if (next === specifier) return whole;

    changes.push([specifier, next]);
    return `${lead}${quote}${next}${quote}`;
  });
  return { content: rewritten, changes };
}

function moveFile(root, from, to) {
  mkdirSync(dirname(join(root, to)), { recursive: true });
  try {
    execFileSync("git", ["mv", from, to], { cwd: root, stdio: "ignore" });
  } catch {
    renameSync(join(root, from), join(root, to));
  }
}

// Removes folders left empty by a move, stopping at src/ itself.
function pruneEmptyDirs(root, dir) {
  const src = join(root, SRC);
  let current = join(root, dir);
  while (current.startsWith(src + sep) && readdirSync(current).length === 0) {
    rmdirSync(current);
    current = dirname(current);
  }
}

function main(argv) {
  const { dryRun, root, pairs } = parseArgs(argv);
  const files = listFiles(join(root, SRC)).map((abs) => toRel(root, abs));
  const known = new Set(files);
  const moves = buildMoves(root, pairs, files);

  const edits = [];
  for (const file of files) {
    const content = readFileSync(join(root, file), "utf8");
    const result = rewriteImports(content, file, moves.get(file) ?? file, moves, known);
    if (result.changes.length > 0) edits.push({ file, ...result });
  }

  const report = [];
  for (const [from, to] of moves) report.push(`move ${from} -> ${to}`);
  for (const { file, changes } of edits) {
    for (const [before, after] of changes) report.push(`  ${file}: "${before}" -> "${after}"`);
  }
  for (const [from, to] of moves) {
    if (GLOB.test(readFileSync(join(root, from), "utf8"))) {
      report.push(`check by hand: ${to} uses import.meta.glob`);
    }
  }

  if (dryRun) {
    console.log(report.join("\n"));
    console.log("dry run: nothing changed");
    return;
  }

  for (const { file, content } of edits) writeFileSync(join(root, file), content);
  for (const [from, to] of moves) {
    moveFile(root, from, to);
    pruneEmptyDirs(root, dirname(from));
  }

  const imports = edits.reduce((sum, edit) => sum + edit.changes.length, 0);
  console.log(report.join("\n"));
  console.log(`moved ${moves.size} file(s), rewrote ${imports} import(s) in ${edits.length} file(s)`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
