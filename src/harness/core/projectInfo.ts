// ============================================================
// projectInfo.ts -- what kind of project(s) a workspace holds and how to
// check them, worked out from the files themselves with no model in the loop:
// manifests (package.json, Cargo.toml, pyproject.toml, go.mod, pom.xml, ...),
// task runners (Makefile, justfile) and the commands CI runs. Backs the
// `project_info` tool, so a model stops guessing whether to run `npm test`,
// `cargo test` or `pytest`, and can tell a build that fails because
// dependencies are missing from one that fails because the code is wrong.
//
// Pure: everything it knows arrives through `ProjectFs`, so the analysis is
// unit-tested against fake file trees and the tool wires it to the real disk.
// Manifest parsing is deliberately light (JSON where the format is JSON,
// line scans for TOML/YAML/Makefile): it only needs names, scripts and a few
// markers, and a manifest it cannot read degrades to "kind known, commands
// unknown" instead of failing.
// ============================================================

import { ciFilesIn, isCiFile } from "./projectCi";

export type CheckId = "install" | "typecheck" | "lint" | "test" | "build" | "format";

export interface ProjectCommand {
  program: string;
  args: string[];
  /** Workspace-relative working directory; "." is the root. */
  cwd: string;
  /** Where the command came from, so a model can judge how far to trust it. */
  source: string;
  note?: string;
}

/** The test runners `run_check` can narrow to one test (see testFilter.ts). */
export type TestRunner = "vitest" | "jest" | "pytest" | "cargo" | "go";

export interface Check extends ProjectCommand {
  id: CheckId;
  /** For a test check: the runner behind the command, when it is one of those. */
  runner?: TestRunner;
}

export interface DevCommand extends ProjectCommand {
  label: string;
}

export interface Project {
  /** Workspace-relative directory; "." is the root. */
  path: string;
  name?: string;
  kinds: string[];
  tools: string[];
  checks: Check[];
  dev: DevCommand[];
  environment: string[];
  notes: string[];
}

export interface CiWorkflow {
  file: string;
  commands: { command: string; /** Workspace-relative working directory; "." is the root. */ cwd: string }[];
}

export interface ProjectInfo {
  projects: Project[];
  /** Projects found but left out of `projects` to keep the answer short. */
  omittedProjects: number;
  ci: CiWorkflow[];
  toolchain: string[];
  /** The file scan stopped early, so some projects may be missing. */
  incomplete: boolean;
}

/** What the analysis needs from the workspace. */
export interface ProjectFs {
  /** Files under the workspace as `/`-separated paths relative to its root,
   * with dependency and build-output folders already left out. */
  files: string[];
  /** The scan hit its size limit before it saw everything. */
  incomplete?: boolean;
  read(path: string): Promise<string | undefined>;
  /** Whether a file or folder exists, including ones `files` leaves out. */
  exists(path: string): Promise<boolean>;
}

/** A formatter failing says nothing about whether the code works. */
const STYLE_ONLY = "style only: a failure does not mean the code is broken";

const MAX_PROJECT_DEPTH = 3;
const MAX_PROJECTS = 12;
const MAX_CI_FILES = 4;

/** Folders that hold copies, samples or tooling rather than the project. */
const NOISE_SEGMENTS = new Set([
  "node_modules", ".git", "target", "dist", "build", "out", "vendor", "fixtures", "__fixtures__", "testdata", "test-data",
  "third_party", "third-party", ".venv", "venv", "site-packages", ".next", "coverage", "__pycache__", "examples", "example",
  "samples", ".cargo", "templates", "template",
]);

const MANIFESTS = new Set([
  "package.json", "Cargo.toml", "pyproject.toml", "requirements.txt", "setup.py", "Pipfile", "go.mod", "pom.xml",
  "build.gradle", "build.gradle.kts", "Makefile", "makefile", "justfile", "Justfile", "Taskfile.yml", "Taskfile.yaml",
  "composer.json", "Gemfile", "pubspec.yaml", "mix.exs", "CMakeLists.txt", "Package.swift", "deno.json", "deno.jsonc",
]);

const dirname = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".");
const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const join = (dir: string, name: string) => (dir === "." ? name : `${dir}/${name}`);
const depthOf = (dir: string) => (dir === "." ? 0 : dir.split("/").length);

/** `dir` and every directory above it, nearest first, ending at ".". */
function withAncestors(dir: string): string[] {
  const chain: string[] = [];
  let current = dir;
  while (current !== ".") {
    chain.push(current);
    current = dirname(current);
  }
  chain.push(".");
  return chain;
}

interface Context {
  fs: ProjectFs;
  files: Set<string>;
  /** File names present in each directory. */
  names: Map<string, Set<string>>;
  texts: Map<string, Promise<string | undefined>>;
}

function readText(ctx: Context, path: string): Promise<string | undefined> {
  let pending = ctx.texts.get(path);
  if (!pending) {
    pending = ctx.fs.read(path).catch(() => undefined);
    ctx.texts.set(path, pending);
  }
  return pending;
}

async function readJson(ctx: Context, path: string): Promise<Record<string, unknown> | undefined> {
  const text = await readText(ctx, path);
  if (text === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(text.replace(/^﻿/, ""));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

const hasFile = (ctx: Context, dir: string, name: string) => ctx.names.get(dir)?.has(name) ?? false;

function newProject(path: string): Project {
  return { path, kinds: [], tools: [], checks: [], dev: [], environment: [], notes: [] };
}

const uniquePush = (list: string[], value: string) => {
  if (!list.includes(value)) list.push(value);
};

function addCheck(project: Project, check: Omit<Check, "cwd"> & { cwd?: string }): void {
  if (project.checks.some((existing) => existing.id === check.id && existing.program === check.program && existing.args.join(" ") === check.args.join(" ") && (existing.cwd === (check.cwd ?? project.path)))) return;
  const added: Check = { ...check, cwd: check.cwd ?? project.path };
  if (added.runner === undefined) delete added.runner;
  project.checks.push(added);
}

// ---------- Node ----------

type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

const LOCKFILES: [string, PackageManager][] = [
  ["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"], ["bun.lockb", "bun"], ["bun.lock", "bun"], ["package-lock.json", "npm"], ["npm-shrinkwrap.json", "npm"],
];

const NODE_KINDS: [string, string][] = [
  ["react", "react"], ["next", "next.js"], ["vue", "vue"], ["nuxt", "nuxt"], ["svelte", "svelte"], ["@sveltejs/kit", "sveltekit"],
  ["astro", "astro"], ["@angular/core", "angular"], ["solid-js", "solid"], ["vite", "vite"], ["electron", "electron"],
  ["express", "express"], ["fastify", "fastify"], ["@nestjs/core", "nestjs"], ["react-native", "react-native"], ["expo", "expo"],
  ["@tauri-apps/api", "tauri"], ["@tauri-apps/cli", "tauri"],
];
const NODE_TOOLS: [string, string][] = [
  ["vitest", "vitest"], ["jest", "jest"], ["mocha", "mocha"], ["@playwright/test", "playwright"], ["cypress", "cypress"],
  ["eslint", "eslint"], ["@biomejs/biome", "biome"], ["prettier", "prettier"],
];

const SCRIPT_NAMES: Record<Exclude<CheckId, "install">, string[]> = {
  typecheck: ["typecheck", "type-check", "check-types", "tsc"],
  lint: ["lint", "lint:check", "eslint"],
  test: ["test", "test:unit", "unit"],
  build: ["build", "compile"],
  // Only the variants that check; a plain `format` script usually rewrites files.
  format: ["format:check", "format-check", "prettier:check", "check:format"],
};
const DEV_SCRIPTS = ["dev", "start", "serve", "develop", "preview"];

/**
 * The runner a test script ends in. Arguments given to `npm run` reach only the
 * last command of the script, so a runner that is not the last command (or that
 * sits behind a pipe) is not one a test filter could be passed to.
 */
function nodeTestRunner(script: string): TestRunner | undefined {
  const last = script.split(/&&|\|\||;/).pop() ?? "";
  if (last.includes("|")) return undefined;
  const found = /(?:^|[\s/])(vitest|jest)\b(?!\.)/.exec(last);
  return found ? (found[1] as TestRunner) : undefined;
}

function packageManagerFor(ctx: Context, dir: string, declared: unknown): PackageManager {
  if (typeof declared === "string") {
    const name = declared.split("@")[0];
    if (name === "pnpm" || name === "yarn" || name === "bun" || name === "npm") return name;
  }
  // A lockfile may sit at a monorepo root above the package.
  for (const candidate of withAncestors(dir)) {
    for (const [file, manager] of LOCKFILES) if (hasFile(ctx, candidate, file)) return manager;
  }
  return "npm";
}

const runScript = (pm: PackageManager, script: string, extra: string[] = []): { program: string; args: string[] } => ({
  program: pm,
  args: pm === "npm" && extra.length > 0 ? ["run", script, "--", ...extra] : ["run", script, ...extra],
});

/** A runner for a locally installed tool, such as `tsc`. */
const execTool = (pm: PackageManager, tool: string, args: string[]): { program: string; args: string[] } =>
  pm === "pnpm" ? { program: "pnpm", args: ["exec", tool, ...args] }
    : pm === "yarn" ? { program: "yarn", args: [tool, ...args] }
      : pm === "bun" ? { program: "bunx", args: [tool, ...args] }
        : { program: "npx", args: [tool, ...args] };

async function detectNode(ctx: Context, dir: string, project: Project): Promise<void> {
  const manifest = join(dir, "package.json");
  const pkg = await readJson(ctx, manifest);
  const pm = packageManagerFor(ctx, dir, pkg?.packageManager);
  uniquePush(project.kinds, `node (${pm})`);
  if (!pkg) {
    project.notes.push(`${manifest} could not be read as JSON, so its scripts are unknown.`);
    return;
  }
  if (typeof pkg.name === "string") project.name ??= pkg.name;

  const dependencies: Record<string, unknown> = {
    ...(pkg.dependencies as Record<string, unknown> | undefined),
    ...(pkg.devDependencies as Record<string, unknown> | undefined),
  };
  const has = (name: string) => name in dependencies;
  for (const [dep, kind] of NODE_KINDS) if (has(dep)) uniquePush(project.kinds, kind);
  for (const [dep, tool] of NODE_TOOLS) if (has(dep)) uniquePush(project.tools, tool);
  const hasTsconfig = hasFile(ctx, dir, "tsconfig.json");
  if (has("typescript") || hasTsconfig) uniquePush(project.kinds, "typescript");
  if (pkg.workspaces || hasFile(ctx, dir, "pnpm-workspace.yaml") || hasFile(ctx, dir, "turbo.json") || hasFile(ctx, dir, "nx.json") || hasFile(ctx, dir, "lerna.json")) {
    uniquePush(project.kinds, "monorepo");
    project.notes.push("Monorepo root: root scripts can span every package; each package below has scripts of its own.");
  }

  const scripts = (pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {}) as Record<string, unknown>;
  const scriptText = (name: string) => (typeof scripts[name] === "string" ? (scripts[name] as string) : undefined);

  for (const id of ["typecheck", "lint", "test", "build", "format"] as const) {
    const name = SCRIPT_NAMES[id].find((candidate) => {
      const value = scriptText(candidate);
      return value !== undefined && !(id === "test" && /no test specified/i.test(value));
    });
    if (!name) continue;
    const value = scriptText(name) as string;
    let extra: string[] = [];
    let note: string | undefined = id === "format" ? STYLE_ONLY : undefined;
    if (id === "test") {
      if (/\bvitest\b/.test(value) && !/(\brun\b|--run\b|--watch(=|\s+)false|--no-watch)/.test(value)) {
        extra = ["--run"];
        note = "the script starts vitest in watch mode, which never exits; --run makes it run once";
      } else if (/--watch(All)?\b/.test(value)) {
        note = "the script uses watch mode and may not exit on its own";
      }
    }
    addCheck(project, { id, ...runScript(pm, name, extra), source: `package.json scripts.${name} = ${value}`, note, runner: id === "test" ? nodeTestRunner(value) : undefined });
  }
  if (!project.checks.some((check) => check.id === "typecheck") && hasTsconfig && has("typescript")) {
    addCheck(project, { id: "typecheck", ...execTool(pm, "tsc", ["--noEmit"]), source: "inferred from tsconfig.json and the typescript dependency", note: "no typecheck script exists" });
  }

  for (const name of DEV_SCRIPTS) {
    const value = scriptText(name);
    if (value === undefined) continue;
    project.dev.push({ label: name, ...runScript(pm, name), cwd: dir, source: `package.json scripts.${name} = ${value}`, note: "long-running; not a check" });
  }

  // Dependencies: a missing node_modules (here or in a parent) explains most "build failures".
  const wantsInstall = Object.keys(dependencies).length > 0;
  if (wantsInstall) {
    let installed = false;
    for (const candidate of withAncestors(dir)) {
      if (await ctx.fs.exists(join(candidate, "node_modules"))) {
        installed = true;
        break;
      }
    }
    if (installed) {
      project.environment.push("dependencies are installed (node_modules found)");
    } else {
      const locked = LOCKFILES.some(([file]) => hasFile(ctx, dir, file) || withAncestors(dir).some((up) => hasFile(ctx, up, file)));
      const install = pm === "npm" ? { program: "npm", args: [locked ? "ci" : "install"] } : { program: pm, args: ["install"] };
      project.environment.push("dependencies are NOT installed (no node_modules): install first, or every check will fail for that reason alone");
      addCheck(project, { id: "install", ...install, source: "node_modules is missing", note: "run this before any other check" });
    }
  }

  const engines = pkg.engines && typeof pkg.engines === "object" ? (pkg.engines as Record<string, unknown>).node : undefined;
  if (typeof engines === "string") project.notes.push(`Requires node ${engines} (package.json engines).`);
}

// ---------- Rust ----------

function tomlSection(text: string, header: string): string | undefined {
  const start = new RegExp(`^\\s*\\[${header.replace(/[.]/g, "\\.")}\\]\\s*$`, "m").exec(text);
  if (!start) return undefined;
  const rest = text.slice(start.index + start[0].length);
  const next = /^\s*\[/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

async function isCargoWorkspaceRoot(ctx: Context, dir: string): Promise<boolean> {
  const text = await readText(ctx, join(dir, "Cargo.toml"));
  return text !== undefined && /^\s*\[workspace\]\s*$/m.test(text);
}

async function detectRust(ctx: Context, dir: string, project: Project, cwd: string = dir): Promise<void> {
  const manifest = join(dir, "Cargo.toml");
  const text = (await readText(ctx, manifest)) ?? "";
  const workspace = /^\s*\[workspace\]\s*$/m.test(text);
  uniquePush(project.kinds, workspace ? "rust (cargo workspace)" : "rust (cargo)");
  const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(tomlSection(text, "package") ?? "")?.[1];
  if (name) project.name ??= name;
  if (workspace) {
    const members = [...(/members\s*=\s*\[([^\]]*)\]/s.exec(text)?.[1].matchAll(/"([^"]+)"/g) ?? [])].map((match) => match[1]);
    if (members.length > 0) project.notes.push(`Cargo workspace members: ${members.slice(0, 8).join(", ")}${members.length > 8 ? ", ..." : ""}.`);
  }
  const all = workspace ? ["--workspace"] : [];
  const source = workspace ? "Cargo workspace" : "Cargo.toml";
  addCheck(project, { id: "typecheck", program: "cargo", args: ["check", ...all], cwd, source, note: "fast compile check without producing binaries" });
  addCheck(project, { id: "lint", program: "cargo", args: ["clippy", ...all, "--all-targets"], cwd, source, note: "inferred: clippy warnings do not fail the command unless -D warnings is added" });
  addCheck(project, { id: "test", program: "cargo", args: ["test", ...all], cwd, source, runner: "cargo" });
  addCheck(project, { id: "build", program: "cargo", args: ["build", ...all], cwd, source });
  addCheck(project, { id: "format", program: "cargo", args: ["fmt", "--check"], cwd, source, note: STYLE_ONLY });
}

// ---------- Python ----------

type PythonTool = "uv" | "poetry" | "pdm" | "pipenv" | "pip";

async function detectPython(ctx: Context, dir: string, project: Project): Promise<void> {
  const pyproject = (await readText(ctx, join(dir, "pyproject.toml"))) ?? "";
  const requirements = (await readText(ctx, join(dir, "requirements.txt"))) ?? "";
  const evidence = `${pyproject}\n${requirements}`;
  const tool: PythonTool = /^\s*\[tool\.poetry/m.test(pyproject) ? "poetry"
    : /^\s*\[tool\.uv/m.test(pyproject) || hasFile(ctx, dir, "uv.lock") ? "uv"
      : /^\s*\[tool\.pdm/m.test(pyproject) ? "pdm"
        : hasFile(ctx, dir, "Pipfile") ? "pipenv" : "pip";
  uniquePush(project.kinds, `python (${tool})`);
  const projectName = /^\s*name\s*=\s*"([^"]+)"/m.exec(tomlSection(pyproject, "project") ?? tomlSection(pyproject, "tool.poetry") ?? "")?.[1];
  if (projectName) project.name ??= projectName;
  for (const [needle, kind] of [["fastapi", "fastapi"], ["flask", "flask"], ["django", "django"]] as const) {
    if (new RegExp(`\\b${needle}\\b`, "i").test(evidence)) uniquePush(project.kinds, kind);
  }

  const run = (program: string, args: string[]): { program: string; args: string[] } =>
    tool === "uv" || tool === "poetry" || tool === "pdm" || tool === "pipenv" ? { program: tool, args: ["run", program, ...args] } : { program, args };
  const files = [...(ctx.names.get(dir) ?? [])];

  const usesPytest = /\bpytest\b/.test(evidence) || files.some((file) => ["pytest.ini", "conftest.py", "tox.ini"].includes(file));
  if (usesPytest) {
    uniquePush(project.tools, "pytest");
    addCheck(project, { id: "test", ...(tool === "pip" ? { program: "python", args: ["-m", "pytest"] } : run("pytest", [])), source: "pytest configuration", runner: "pytest" });
  } else if (hasFile(ctx, dir, "manage.py")) {
    addCheck(project, { id: "test", program: "python", args: ["manage.py", "test"], source: "manage.py (Django)" });
  }
  if (/^\s*\[tool\.ruff/m.test(pyproject) || files.includes("ruff.toml") || files.includes(".ruff.toml") || /\bruff\b/.test(evidence)) {
    uniquePush(project.tools, "ruff");
    addCheck(project, { id: "lint", ...run("ruff", ["check", "."]), source: "ruff configuration" });
  } else if (files.includes(".flake8") || /\bflake8\b/.test(evidence)) {
    addCheck(project, { id: "lint", ...run("flake8", []), source: "flake8 configuration" });
  }
  if (/^\s*\[tool\.mypy/m.test(pyproject) || files.includes("mypy.ini") || /\bmypy\b/.test(evidence)) {
    uniquePush(project.tools, "mypy");
    addCheck(project, { id: "typecheck", ...run("mypy", ["."]), source: "mypy configuration" });
  } else if (files.includes("pyrightconfig.json") || /^\s*\[tool\.pyright/m.test(pyproject)) {
    uniquePush(project.tools, "pyright");
    addCheck(project, { id: "typecheck", ...run("pyright", []), source: "pyright configuration" });
  }

  let hasEnv = false;
  for (const candidate of [".venv", "venv"]) if (await ctx.fs.exists(join(dir, candidate))) hasEnv = true;
  if (hasEnv) {
    project.environment.push("a virtual environment exists (.venv or venv)");
  } else if (tool === "uv" || tool === "poetry" || tool === "pdm" || tool === "pipenv") {
    project.environment.push(`no virtual environment found: run ${tool} ${tool === "uv" ? "sync" : "install"} first`);
    addCheck(project, { id: "install", program: tool, args: [tool === "uv" ? "sync" : "install"], source: "no .venv found", note: "run this before any other check" });
  } else if (requirements) {
    project.environment.push("no virtual environment found (.venv or venv); dependencies may not be installed");
    addCheck(project, { id: "install", program: "pip", args: ["install", "-r", "requirements.txt"], source: "requirements.txt", note: "run in a virtual environment" });
  }
  const required = /^\s*requires-python\s*=\s*"([^"]+)"/m.exec(pyproject)?.[1];
  if (required) project.notes.push(`Requires Python ${required} (pyproject.toml).`);
}

// ---------- Go, JVM, .NET ----------

async function detectGo(ctx: Context, dir: string, project: Project): Promise<void> {
  const text = (await readText(ctx, join(dir, "go.mod"))) ?? "";
  uniquePush(project.kinds, "go");
  const module = /^\s*module\s+(\S+)/m.exec(text)?.[1];
  if (module) project.name ??= module;
  const version = /^\s*go\s+(\S+)/m.exec(text)?.[1];
  if (version) project.notes.push(`Go ${version} (go.mod).`);
  addCheck(project, { id: "build", program: "go", args: ["build", "./..."], source: "go.mod" });
  addCheck(project, { id: "lint", program: "go", args: ["vet", "./..."], source: "go.mod" });
  addCheck(project, { id: "test", program: "go", args: ["test", "./..."], source: "go.mod", runner: "go" });
}

function detectJvm(ctx: Context, dir: string, project: Project): void {
  if (hasFile(ctx, dir, "pom.xml")) {
    uniquePush(project.kinds, "java (maven)");
    const program = hasFile(ctx, dir, "mvnw") ? "./mvnw" : "mvn";
    addCheck(project, { id: "test", program, args: ["test"], source: "pom.xml" });
    addCheck(project, { id: "build", program, args: ["package"], source: "pom.xml" });
  }
  if (hasFile(ctx, dir, "build.gradle") || hasFile(ctx, dir, "build.gradle.kts")) {
    uniquePush(project.kinds, hasFile(ctx, dir, "build.gradle.kts") ? "kotlin/java (gradle)" : "java (gradle)");
    const program = hasFile(ctx, dir, "gradlew") ? "./gradlew" : "gradle";
    addCheck(project, { id: "test", program, args: ["test"], source: "build.gradle" });
    addCheck(project, { id: "build", program, args: ["build"], source: "build.gradle" });
  }
}

function detectDotnet(ctx: Context, dir: string, project: Project): void {
  const names = [...(ctx.names.get(dir) ?? [])];
  if (!names.some((name) => /\.(sln|csproj|fsproj)$/.test(name))) return;
  uniquePush(project.kinds, ".net");
  addCheck(project, { id: "build", program: "dotnet", args: ["build"], source: "a .sln/.csproj file" });
  addCheck(project, { id: "test", program: "dotnet", args: ["test"], source: "a .sln/.csproj file" });
}

// ---------- Task runners ----------

const TASK_TARGETS: Record<string, CheckId> = {
  test: "test", tests: "test", check: "typecheck", typecheck: "typecheck", lint: "lint", build: "build", all: "build",
  fmt: "format", "format-check": "format", "check-format": "format", verify: "test", ci: "test",
};

function checkIdForTarget(target: string): CheckId | undefined {
  return TASK_TARGETS[target.toLowerCase()];
}

async function detectTaskRunner(ctx: Context, dir: string, project: Project): Promise<void> {
  const makefile = ["Makefile", "makefile"].find((name) => hasFile(ctx, dir, name));
  const justfile = ["justfile", "Justfile"].find((name) => hasFile(ctx, dir, name));
  const taskfile = ["Taskfile.yml", "Taskfile.yaml"].find((name) => hasFile(ctx, dir, name));
  const sources: { file: string; program: string; targets: string[] }[] = [];
  if (makefile) {
    const text = (await readText(ctx, join(dir, makefile))) ?? "";
    const targets = [...text.matchAll(/^([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*:(?![=])/gm)].map((match) => match[1]);
    sources.push({ file: makefile, program: "make", targets });
  }
  if (justfile) {
    const text = (await readText(ctx, join(dir, justfile))) ?? "";
    const targets = [...text.matchAll(/^([A-Za-z0-9_][A-Za-z0-9_-]*)\b[^:=\n]*:(?!=)/gm)].map((match) => match[1]);
    sources.push({ file: justfile, program: "just", targets });
  }
  if (taskfile) {
    const text = (await readText(ctx, join(dir, taskfile))) ?? "";
    const tasks = yamlBlockKeys(text, "tasks");
    sources.push({ file: taskfile, program: "task", targets: tasks });
  }
  for (const { file, program, targets } of sources) {
    uniquePush(project.kinds, program);
    const unique = [...new Set(targets)];
    if (unique.length > 0) project.notes.push(`${file} targets: ${unique.slice(0, 12).join(", ")}${unique.length > 12 ? ", ..." : ""}.`);
    for (const target of unique) {
      const id = checkIdForTarget(target);
      // A task runner's target fills a gap; it does not repeat a check a manifest already gave.
      if (id && !project.checks.some((check) => check.id === id)) addCheck(project, { id, program, args: [target], source: `${file} target "${target}"` });
    }
  }
}

/** The names directly under a top-level `key:` block of a small YAML file. */
function yamlBlockKeys(text: string, key: string): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^${key}:\\s*$`).test(line));
  if (start < 0) return [];
  const names: string[] = [];
  let indent: number | undefined;
  for (const line of lines.slice(start + 1)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const column = line.length - line.trimStart().length;
    if (column === 0) break;
    indent ??= column;
    const match = column === indent ? /^\s*([A-Za-z0-9_:-]+):/.exec(line) : null;
    if (match) names.push(match[1]);
  }
  return names;
}

const OTHER_ECOSYSTEMS: [string, string][] = [
  ["composer.json", "php (composer)"], ["Gemfile", "ruby (bundler)"], ["pubspec.yaml", "dart/flutter"], ["mix.exs", "elixir (mix)"],
  ["CMakeLists.txt", "c/c++ (cmake)"], ["Package.swift", "swift (swiftpm)"], ["deno.json", "deno"], ["deno.jsonc", "deno"],
];

// ---------- Putting it together ----------

function isNoise(path: string): boolean {
  return path.split("/").slice(0, -1).some((segment) => NOISE_SEGMENTS.has(segment));
}

function isManifestName(name: string): boolean {
  return MANIFESTS.has(name) || /\.(sln|csproj|fsproj)$/.test(name);
}

const TAURI_FILES = ["tauri.conf.json", "tauri.conf.json5", "Tauri.toml"];

export async function analyzeProject(fs: ProjectFs): Promise<ProjectInfo> {
  const ctx: Context = { fs, files: new Set(), names: new Map(), texts: new Map() };
  for (const file of fs.files) {
    // CI files are kept even inside a folder the scan otherwise treats as noise.
    if (isNoise(file) && !isCiFile(file)) continue;
    ctx.files.add(file);
    const dir = dirname(file);
    if (!ctx.names.has(dir)) ctx.names.set(dir, new Set());
    ctx.names.get(dir)?.add(basename(file));
  }

  const manifestDirs = [...ctx.names.entries()]
    .filter(([dir, names]) => depthOf(dir) <= MAX_PROJECT_DEPTH && !/(^|\/)\.github(\/|$)/.test(dir) && [...names].some(isManifestName))
    .map(([dir]) => dir)
    .sort((a, b) => depthOf(a) - depthOf(b) || a.localeCompare(b));

  const projects = new Map<string, Project>();
  const tauriBackends = new Map<string, string>(); // src-tauri dir -> the frontend project it belongs to

  for (const dir of manifestDirs) {
    const project = newProject(dir);
    const names = ctx.names.get(dir) ?? new Set<string>();

    if (names.has("package.json")) await detectNode(ctx, dir, project);

    if (names.has("Cargo.toml")) {
      const isTauriBackend = TAURI_FILES.some((file) => names.has(file));
      const frontend = dirname(dir);
      const frontendHasNode = isTauriBackend && dir !== "." && ctx.names.get(frontend)?.has("package.json");
      // A crate inside a cargo workspace is a member, not a project of its own.
      let member = false;
      for (const ancestor of withAncestors(dir).slice(1)) {
        if (ctx.names.get(ancestor)?.has("Cargo.toml") && (await isCargoWorkspaceRoot(ctx, ancestor))) member = true;
      }
      if (frontendHasNode) tauriBackends.set(dir, frontend);
      else if (!member) await detectRust(ctx, dir, project);
      if (isTauriBackend && !frontendHasNode && !member) uniquePush(project.kinds, "tauri");
    }

    if (names.has("pyproject.toml") || names.has("requirements.txt") || names.has("setup.py") || names.has("Pipfile")) await detectPython(ctx, dir, project);
    if (names.has("go.mod")) await detectGo(ctx, dir, project);
    detectJvm(ctx, dir, project);
    detectDotnet(ctx, dir, project);
    await detectTaskRunner(ctx, dir, project);
    for (const [file, kind] of OTHER_ECOSYSTEMS) {
      if (names.has(file)) {
        uniquePush(project.kinds, kind);
        project.notes.push(`${file} found, but no commands are detected for ${kind}: read its manifest or README.`);
      }
    }
    if (project.kinds.length > 0) projects.set(dir, project);
  }

  // A Tauri desktop app: the Rust half belongs to the frontend project that launches it.
  for (const [backend, frontend] of tauriBackends) {
    const project = projects.get(frontend);
    if (!project) continue;
    uniquePush(project.kinds, "tauri");
    const rustNote = await rustFor(ctx, backend, project);
    project.notes.push(rustNote);
    if (project.dev.some((entry) => entry.label === "dev")) {
      project.notes.push("`dev` starts only the web frontend; the desktop app itself needs the `tauri dev` script.");
    }
    const tauriScript = await tauriScriptFor(ctx, frontend);
    if (tauriScript) {
      project.dev.push({ label: "tauri dev (desktop app)", ...tauriScript.dev, cwd: frontend, source: "package.json scripts.tauri", note: "long-running; opens the desktop app" });
      project.dev.push({ label: "tauri build (distributable)", ...tauriScript.build, cwd: frontend, source: "package.json scripts.tauri", note: "slow; produces installers" });
    }
  }

  const ordered = [...projects.values()];
  const shown = ordered.slice(0, MAX_PROJECTS);

  const knownDirs = new Set<string>();
  for (const dir of ctx.names.keys()) for (const ancestor of withAncestors(dir)) knownDirs.add(ancestor);

  const ci: CiWorkflow[] = [];
  for (const { file, parse } of ciFilesIn([...ctx.files]).slice(0, MAX_CI_FILES)) {
    const parsed = parse((await readText(ctx, file)) ?? "");
    // A command runs relative to the repository the CI file belongs to.
    const repo = file.includes("/.github/") ? file.slice(0, file.indexOf("/.github/")) : file.startsWith(".github/") ? "." : dirname(file);
    const commands = parsed.map(({ command, dir }) => {
      const sub = dir?.replace(/^\.\//, "").replace(/\/+$/, "");
      if (!sub || sub === ".") return { command, cwd: repo };
      // Usually the directory is inside the repo. A workflow that checks several
      // repos out side by side names it from the CI workspace root instead, so
      // when the repo-relative path does not exist, try the workspace-relative one.
      const inRepo = join(repo, sub);
      return { command, cwd: [inRepo, sub].find((candidate) => knownDirs.has(candidate)) ?? inRepo };
    });
    if (commands.length > 0) ci.push({ file, commands });
  }

  return { projects: shown, omittedProjects: ordered.length - shown.length, ci, toolchain: await toolchainFor(ctx), incomplete: fs.incomplete === true };
}

async function rustFor(ctx: Context, backend: string, project: Project): Promise<string> {
  const holder = newProject(project.path);
  await detectRust(ctx, backend, holder, backend);
  for (const check of holder.checks) addCheck(project, check);
  for (const kind of holder.kinds) uniquePush(project.kinds, kind);
  uniquePush(project.tools, "cargo");
  return `The desktop backend is Rust in ${backend}: its checks run with that folder as the working directory.`;
}

async function tauriScriptFor(ctx: Context, frontend: string): Promise<{ dev: { program: string; args: string[] }; build: { program: string; args: string[] } } | undefined> {
  const pkg = await readJson(ctx, join(frontend, "package.json"));
  const scripts = pkg?.scripts as Record<string, unknown> | undefined;
  if (!scripts || typeof scripts.tauri !== "string") return undefined;
  const pm = packageManagerFor(ctx, frontend, pkg?.packageManager);
  return { dev: runScript(pm, "tauri", ["dev"]), build: runScript(pm, "tauri", ["build"]) };
}

async function toolchainFor(ctx: Context): Promise<string[]> {
  const lines: string[] = [];
  const root = ctx.names.get(".") ?? new Set<string>();
  for (const file of [".nvmrc", ".node-version"]) {
    if (!root.has(file)) continue;
    const text = ((await readText(ctx, file)) ?? "").trim().split(/\s/)[0];
    if (text) lines.push(`node ${text} (${file})`);
  }
  if (root.has("rust-toolchain.toml") || root.has("rust-toolchain")) {
    const file = root.has("rust-toolchain.toml") ? "rust-toolchain.toml" : "rust-toolchain";
    const text = (await readText(ctx, file)) ?? "";
    const channel = /channel\s*=\s*"([^"]+)"/.exec(text)?.[1] ?? (file === "rust-toolchain" ? text.trim().split(/\s/)[0] : undefined);
    if (channel) lines.push(`rust ${channel} (${file})`);
  }
  if (root.has(".python-version")) {
    const text = ((await readText(ctx, ".python-version")) ?? "").trim().split(/\s/)[0];
    if (text) lines.push(`python ${text} (.python-version)`);
  }
  return lines;
}

// ---------- What the model reads ----------

const CHECK_ORDER: CheckId[] = ["install", "typecheck", "lint", "test", "build", "format"];

const commandLine = (command: ProjectCommand) => [command.program, ...command.args].join(" ");

function renderProject(project: Project, index: number): string[] {
  const where = project.path === "." ? "workspace root" : project.path;
  const showName = project.name !== undefined && project.name !== basename(project.path) && project.name !== project.path;
  const lines = [`[${index}] ${showName ? `${project.name} - ` : ""}${where}`];
  lines.push(`  Kinds: ${project.kinds.join(", ")}${project.tools.length > 0 ? `   Tools: ${project.tools.join(", ")}` : ""}`);
  for (const line of project.environment) lines.push(`  Environment: ${line}`);
  const checks = [...project.checks].sort((a, b) => CHECK_ORDER.indexOf(a.id) - CHECK_ORDER.indexOf(b.id));
  if (checks.length > 0) {
    lines.push("  Checks (run_check runs these by name; with run_command pass program and args separately, cwd as shown):");
    for (const check of checks) {
      const cwd = check.cwd === "." ? "" : `   cwd: ${check.cwd}`;
      lines.push(`  - ${check.id}: ${commandLine(check)}${cwd}${check.id === "install" ? "   (call install_dependencies)" : ""}${check.id === "test" && check.runner ? "   (run_check can run one test: test_name, test_file)" : ""}`);
      lines.push(`      from ${check.source}${check.note ? `; ${check.note}` : ""}`);
    }
  } else {
    lines.push("  Checks: none detected.");
  }
  if (project.dev.length > 0) {
    lines.push("  Long-running (start with care; never use as a check):");
    for (const entry of project.dev) lines.push(`  - ${entry.label}: ${commandLine(entry)}${entry.cwd === "." ? "" : `   cwd: ${entry.cwd}`}`);
  }
  for (const note of project.notes) lines.push(`  Note: ${note}`);
  return lines;
}

/** The `project_info` answer: what is here, how to check it, what state it is in. */
export function formatProjectInfo(info: ProjectInfo): string {
  if (info.projects.length === 0) {
    const hint = info.incomplete ? " The workspace was too large to scan completely; pass path to look inside one folder." : "";
    return `No recognizable project was found (no package.json, Cargo.toml, pyproject.toml, go.mod, pom.xml, Makefile or similar within ${MAX_PROJECT_DEPTH} folders of the root). Use list_files and read_file to find out what this is.${hint}`;
  }
  const out: string[] = [];
  out.push(info.projects.length === 1 ? "1 project found." : `${info.projects.length + info.omittedProjects} projects found.`);
  out.push("");
  info.projects.forEach((project, index) => {
    out.push(...renderProject(project, index + 1), "");
  });
  if (info.omittedProjects > 0) out.push(`... and ${info.omittedProjects} more projects. Pass path to look inside one folder.`, "");
  if (info.toolchain.length > 0) out.push(`Toolchain pins: ${info.toolchain.join("; ")}`, "");
  if (info.ci.length > 0) {
    out.push("CI runs these commands (the most reliable statement of how this project is built and checked; they were left out if they publish or deploy):");
    for (const workflow of info.ci) {
      out.push(`  ${workflow.file}:`);
      for (const { command, cwd } of workflow.commands) out.push(`    ${command}${cwd === "." ? "" : `   cwd: ${cwd}`}`);
    }
    out.push("");
  }
  if (info.incomplete) out.push("Note: the workspace was too large to scan completely, so some projects may be missing; pass path to look inside one folder.", "");
  out.push("Failing checks: if a check fails because a tool or dependency is missing (see Environment), install it first; that is an environment problem, not a code bug.");
  return out.join("\n");
}

const BRIEF_PROJECTS = 6;

/** A few lines for the system prompt, so a model starts a run knowing what the
 * workspace holds instead of spending its first calls finding out. It names the
 * projects, the checks `run_check` can run and whether dependencies are
 * missing, and leaves the exact commands to `project_info`. Undefined when
 * nothing recognizable was found, so the prompt gains nothing then. */
export function formatProjectBrief(info: ProjectInfo): string | undefined {
  if (info.projects.length === 0) return undefined;
  const lines = ["Detected workspace (from manifests and CI; call project_info for exact commands, run_check to run one):"];
  for (const project of info.projects.slice(0, BRIEF_PROJECTS)) {
    const where = project.path === "." ? "workspace root" : project.path;
    const names = project.checks.map((check) => check.id).filter((id) => id !== "install");
    const parts = [`${project.kinds.join(", ")}${project.tools.length > 0 ? ` (${project.tools.join(", ")})` : ""}`];
    parts.push(names.length > 0 ? `checks: ${[...new Set(names)].sort((a, b) => CHECK_ORDER.indexOf(a as CheckId) - CHECK_ORDER.indexOf(b as CheckId)).join(", ")}` : "no checks detected");
    if (project.checks.some((check) => check.id === "install")) parts.push("dependencies NOT installed: call install_dependencies before any check");
    lines.push(`- ${where}: ${parts.join("; ")}`);
  }
  const more = info.projects.length - BRIEF_PROJECTS + info.omittedProjects;
  if (more > 0) lines.push(`- ... and ${more} more projects`);
  if (info.incomplete) lines.push("- (the workspace was too large to scan completely, so some projects may be missing)");
  return lines.join("\n");
}

/** Narrows a result to the projects at or under `path`, or the one containing it. */
export function focusProjects(info: ProjectInfo, path: string): ProjectInfo {
  const base = path.replace(/^\.\/+|\/+$/g, "");
  if (base === "" || base === ".") return info;
  const under = info.projects.filter((project) => project.path === base || project.path.startsWith(`${base}/`));
  const containing = info.projects
    .filter((project) => project.path === "." || base.startsWith(`${project.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  const chosen = under.length > 0 ? under : containing ? [containing] : [];
  return { ...info, projects: chosen, omittedProjects: 0 };
}

export type CheckSelection =
  | { ok: true; project: Project; checks: Check[]; installNeeded: boolean }
  | { ok: false; error: string };

const projectLabel = (project: Project) => (project.path === "." ? "the workspace root" : project.path);

/**
 * Which detected command(s) a request for the `id` check means. Exactly one
 * project must have it: with several candidates the caller has to say which,
 * rather than this guessing and running the wrong project's build.
 * A project can hold several commands for one check (a Tauri app typechecks
 * with both `tsc` and `cargo check`); all of them are returned.
 */
export function selectChecks(info: ProjectInfo, id: CheckId, path = ""): CheckSelection {
  if (info.projects.length === 0) {
    return { ok: false, error: "No recognizable project was found, so there is no check to run. Use list_files and read_file to find out what this is, and run_command for a specific command." };
  }
  const requested = path.trim().replace(/^\.\/+|\/+$/g, "");
  const scoped = requested === "" || requested === "." ? info : focusProjects(info, requested);
  if (scoped.projects.length === 0) {
    return { ok: false, error: `No project found at or above '${requested}'. Projects here: ${info.projects.map(projectLabel).join(", ")}.` };
  }

  const candidates = scoped.projects.filter((project) => project.checks.some((check) => check.id === id));
  if (candidates.length === 0) {
    const where = scoped.projects.length === 1 ? projectLabel(scoped.projects[0]) : "the projects found";
    if (id === "install") {
      return { ok: false, error: `Nothing to install: dependencies already appear to be installed for ${where}.` };
    }
    const available = scoped.projects
      .map((project) => `${projectLabel(project)}: ${[...new Set(project.checks.filter((check) => check.id !== "install").map((check) => check.id))].join(", ") || "no checks detected"}`)
      .join("; ");
    return {
      ok: false,
      error: `No ${id} check was detected for ${where}. Detected checks: ${available}. Call project_info to see how it is built, and use run_command for a command it does not cover.`,
    };
  }
  if (candidates.length > 1) {
    return { ok: false, error: `Several projects have a ${id} check: ${candidates.map(projectLabel).join(", ")}. Call run_check again with path set to one of them.` };
  }

  const project = candidates[0];
  return { ok: true, project, checks: project.checks.filter((check) => check.id === id), installNeeded: project.checks.some((check) => check.id === "install") };
}
