import { describe, expect, it } from "vitest";

import { analyzeProject, focusProjects, formatProjectBrief, formatProjectInfo, selectChecks, type Check, type Project, type ProjectFs } from "./projectInfo";

/** A fake workspace: `tree` maps relative file paths to their contents. */
function fakeFs(tree: Record<string, string>, options: { exists?: string[]; incomplete?: boolean } = {}): ProjectFs {
  const present = new Set(options.exists ?? []);
  return {
    files: Object.keys(tree),
    incomplete: options.incomplete,
    read: async (path) => {
      if (!(path in tree)) throw new Error(`no such file: ${path}`);
      return tree[path];
    },
    exists: async (path) => present.has(path) || path in tree || Object.keys(tree).some((file) => file.startsWith(`${path}/`)),
  };
}

const json = (value: unknown) => JSON.stringify(value);

const checkFor = (project: Project, id: Check["id"], cwd?: string) => project.checks.find((check) => check.id === id && (cwd === undefined || check.cwd === cwd));

const webPackage = json({
  name: "web",
  scripts: { dev: "vite", build: "vite build", test: "vitest run", lint: "eslint .", typecheck: "tsc --noEmit" },
  dependencies: { react: "^18" },
  devDependencies: { typescript: "^5", vite: "^5", vitest: "^1", eslint: "^9" },
});

describe("Node projects", () => {
  it("reads the package manager, kinds, tools and the scripts that check the project", async () => {
    const info = await analyzeProject(fakeFs({ "package.json": webPackage, "package-lock.json": "{}", "tsconfig.json": "{}", "src/main.tsx": "" }, { exists: ["node_modules"] }));
    expect(info.projects).toHaveLength(1);
    const [project] = info.projects;
    expect(project.path).toBe(".");
    expect(project.name).toBe("web");
    expect(project.kinds).toEqual(expect.arrayContaining(["node (npm)", "react", "vite", "typescript"]));
    expect(project.tools).toEqual(expect.arrayContaining(["vitest", "eslint"]));
    expect(checkFor(project, "typecheck")).toMatchObject({ program: "npm", args: ["run", "typecheck"], cwd: "." });
    expect(checkFor(project, "test")).toMatchObject({ program: "npm", args: ["run", "test"] });
    expect(checkFor(project, "lint")).toMatchObject({ args: ["run", "lint"] });
    expect(checkFor(project, "build")).toMatchObject({ args: ["run", "build"] });
    expect(checkFor(project, "format")).toBeUndefined();
    expect(project.environment).toEqual(["dependencies are installed (node_modules found)"]);
    expect(project.dev).toMatchObject([{ label: "dev", program: "npm", args: ["run", "dev"], note: "long-running; not a check" }]);
  });

  it("says dependencies are missing and puts an install first, using ci when a lockfile exists", async () => {
    const withLock = await analyzeProject(fakeFs({ "package.json": webPackage, "package-lock.json": "{}" }));
    expect(withLock.projects[0].environment[0]).toMatch(/NOT installed/);
    expect(checkFor(withLock.projects[0], "install")).toMatchObject({ program: "npm", args: ["ci"] });

    const withoutLock = await analyzeProject(fakeFs({ "package.json": webPackage }));
    expect(checkFor(withoutLock.projects[0], "install")).toMatchObject({ program: "npm", args: ["install"] });
  });

  it("finds node_modules hoisted to a parent folder", async () => {
    const info = await analyzeProject(fakeFs({ "package.json": json({ workspaces: ["packages/*"] }), "packages/web/package.json": webPackage }, { exists: ["node_modules"] }));
    const web = info.projects.find((project) => project.path === "packages/web");
    expect(web?.environment[0]).toMatch(/installed/);
    expect(checkFor(web as Project, "install")).toBeUndefined();
  });

  it("uses pnpm, yarn or bun from a lockfile, even one at the monorepo root", async () => {
    const forLock = async (lock: string) => {
      const info = await analyzeProject(fakeFs({ [lock]: "", "apps/web/package.json": json({ scripts: { build: "x" }, dependencies: { a: "1" } }) }, { exists: ["node_modules"] }));
      return checkFor(info.projects[0], "build");
    };
    expect(await forLock("pnpm-lock.yaml")).toMatchObject({ program: "pnpm", args: ["run", "build"] });
    expect(await forLock("yarn.lock")).toMatchObject({ program: "yarn", args: ["run", "build"] });
    expect(await forLock("bun.lockb")).toMatchObject({ program: "bun", args: ["run", "build"] });
  });

  it("prefers the packageManager field over a lockfile", async () => {
    const info = await analyzeProject(fakeFs({ "package.json": json({ packageManager: "pnpm@9.1.0", scripts: { build: "x" } }), "package-lock.json": "{}" }));
    expect(checkFor(info.projects[0], "build")?.program).toBe("pnpm");
  });

  it("makes a watch-mode vitest script run once, forwarding the flag the way each manager needs", async () => {
    const npm = await analyzeProject(fakeFs({ "package.json": json({ scripts: { test: "vitest" } }) }));
    expect(checkFor(npm.projects[0], "test")).toMatchObject({ args: ["run", "test", "--", "--run"], note: expect.stringContaining("watch mode") });
    const pnpm = await analyzeProject(fakeFs({ "package.json": json({ packageManager: "pnpm@9", scripts: { test: "vitest" } }) }));
    expect(checkFor(pnpm.projects[0], "test")?.args).toEqual(["run", "test", "--run"]);
    const already = await analyzeProject(fakeFs({ "package.json": json({ scripts: { test: "vitest run" } }) }));
    expect(checkFor(already.projects[0], "test")?.args).toEqual(["run", "test"]);
    const warns = await analyzeProject(fakeFs({ "package.json": json({ scripts: { test: "jest --watch" } }) }));
    expect(checkFor(warns.projects[0], "test")?.note).toMatch(/watch mode/);
  });

  it("ignores the placeholder test script npm init writes", async () => {
    const info = await analyzeProject(fakeFs({ "package.json": json({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) }));
    expect(checkFor(info.projects[0], "test")).toBeUndefined();
  });

  it("infers a tsc typecheck when TypeScript is configured but no script exists, per package manager", async () => {
    const infer = async (extra: Record<string, string>, pkg: Record<string, unknown> = {}) => {
      const info = await analyzeProject(fakeFs({ "package.json": json({ devDependencies: { typescript: "5" }, ...pkg }), "tsconfig.json": "{}", ...extra }, { exists: ["node_modules"] }));
      return checkFor(info.projects[0], "typecheck");
    };
    expect(await infer({})).toMatchObject({ program: "npx", args: ["tsc", "--noEmit"], note: "no typecheck script exists" });
    expect(await infer({ "pnpm-lock.yaml": "" })).toMatchObject({ program: "pnpm", args: ["exec", "tsc", "--noEmit"] });
    expect(await infer({ "yarn.lock": "" })).toMatchObject({ program: "yarn", args: ["tsc", "--noEmit"] });
    expect(await infer({ "bun.lockb": "" })).toMatchObject({ program: "bunx", args: ["tsc", "--noEmit"] });
  });

  it("keeps the kind but reports unreadable JSON instead of failing", async () => {
    const info = await analyzeProject(fakeFs({ "package.json": "{ not json" }));
    expect(info.projects[0].kinds).toEqual(["node (npm)"]);
    expect(info.projects[0].checks).toEqual([]);
    expect(info.projects[0].notes[0]).toMatch(/could not be read as JSON/);
  });

  it("treats a workspaces root as a monorepo and reads the engines requirement", async () => {
    const info = await analyzeProject(fakeFs({ "package.json": json({ workspaces: ["packages/*"], engines: { node: ">=20" } }) }));
    expect(info.projects[0].kinds).toContain("monorepo");
    expect(info.projects[0].notes.join(" ")).toContain("Requires node >=20");
  });
});

describe("Tauri desktop apps", () => {
  const tauriTree = {
    "package.json": json({
      name: "ide",
      scripts: { dev: "vite", build: "vite build", typecheck: "tsc --noEmit", test: "vitest run", tauri: "tauri" },
      dependencies: { react: "18" },
      devDependencies: { "@tauri-apps/cli": "2", typescript: "5", vitest: "1" },
    }),
    "package-lock.json": "{}",
    "tsconfig.json": "{}",
    "src-tauri/Cargo.toml": '[package]\nname = "ide"\nversion = "0.1.0"\n',
    "src-tauri/tauri.conf.json": "{}",
    "src-tauri/src/lib.rs": "",
  };

  it("folds the Rust backend into the frontend project, with its own working directory", async () => {
    const info = await analyzeProject(fakeFs(tauriTree, { exists: ["node_modules"] }));
    expect(info.projects.map((project) => project.path)).toEqual(["."]);
    const [project] = info.projects;
    expect(project.kinds).toEqual(expect.arrayContaining(["node (npm)", "tauri", "rust (cargo)"]));
    expect(checkFor(project, "typecheck", ".")).toMatchObject({ program: "npm", args: ["run", "typecheck"] });
    expect(checkFor(project, "typecheck", "src-tauri")).toMatchObject({ program: "cargo", args: ["check"] });
    expect(checkFor(project, "test", "src-tauri")).toMatchObject({ program: "cargo", args: ["test"] });
  });

  it("separates the web dev server from the desktop app and the slow build", async () => {
    const [project] = (await analyzeProject(fakeFs(tauriTree, { exists: ["node_modules"] }))).projects;
    expect(project.dev.map((entry) => entry.label)).toEqual(["dev", "tauri dev (desktop app)", "tauri build (distributable)"]);
    expect(project.dev[1]).toMatchObject({ program: "npm", args: ["run", "tauri", "--", "dev"] });
    expect(project.notes.join(" ")).toContain("`dev` starts only the web frontend");
  });

  it("keeps a lone src-tauri as its own tauri project when no package.json launches it", async () => {
    const info = await analyzeProject(fakeFs({ "src-tauri/Cargo.toml": '[package]\nname = "solo"\n', "src-tauri/tauri.conf.json": "{}" }));
    expect(info.projects.map((project) => project.path)).toEqual(["src-tauri"]);
    expect(info.projects[0].kinds).toEqual(expect.arrayContaining(["rust (cargo)", "tauri"]));
  });
});

describe("a workspace of several projects", () => {
  const tree = {
    "rusty-core/Cargo.toml": '[workspace]\nmembers = [\n  "crates/a",\n  "crates/b",\n]\n',
    "rusty-core/crates/a/Cargo.toml": '[package]\nname = "a"\n',
    "rusty-core/crates/b/Cargo.toml": '[package]\nname = "b"\n',
    "rusty-ide/package.json": json({ scripts: { test: "vitest run", tauri: "tauri" }, dependencies: { react: "18" } }),
    "rusty-ide/package-lock.json": "{}",
    "rusty-ide/src-tauri/Cargo.toml": '[package]\nname = "ide"\n',
    "rusty-ide/src-tauri/tauri.conf.json": "{}",
    "rusty-website/package.json": json({ scripts: { build: "astro build" }, dependencies: { astro: "4" } }),
    "rusty-website/pnpm-lock.yaml": "",
  };

  it("finds each project once and does not list cargo workspace members as projects", async () => {
    const info = await analyzeProject(fakeFs(tree, { exists: ["rusty-ide/node_modules", "rusty-website/node_modules"] }));
    expect(info.projects.map((project) => project.path)).toEqual(["rusty-core", "rusty-ide", "rusty-website"]);
    const [core, ide, site] = info.projects;
    expect(core.kinds).toEqual(["rust (cargo workspace)"]);
    expect(checkFor(core, "typecheck")).toMatchObject({ program: "cargo", args: ["check", "--workspace"], cwd: "rusty-core" });
    expect(core.notes.join(" ")).toContain("crates/a, crates/b");
    expect(ide.kinds).toEqual(expect.arrayContaining(["tauri"]));
    expect(checkFor(ide, "test", "rusty-ide")).toMatchObject({ args: ["run", "test"] });
    expect(site.kinds).toEqual(expect.arrayContaining(["node (pnpm)", "astro"]));
    expect(checkFor(site, "build")).toMatchObject({ program: "pnpm", cwd: "rusty-website" });
  });

  it("focuses on one project, or the project that contains a folder", async () => {
    const info = await analyzeProject(fakeFs(tree, { exists: ["rusty-ide/node_modules"] }));
    expect(focusProjects(info, "rusty-ide").projects.map((project) => project.path)).toEqual(["rusty-ide"]);
    expect(focusProjects(info, "./rusty-ide/").projects).toHaveLength(1);
    expect(focusProjects(info, "rusty-ide/src/components").projects.map((project) => project.path)).toEqual(["rusty-ide"]);
    expect(focusProjects(info, "nowhere").projects).toEqual([]);
    expect(focusProjects(info, ".").projects).toHaveLength(3);
  });
});

describe("selectChecks", () => {
  const tree = {
    "core/Cargo.toml": '[workspace]\nmembers = []\n',
    "ide/package.json": json({ scripts: { typecheck: "tsc --noEmit", test: "vitest run", tauri: "tauri" }, dependencies: { react: "18" } }),
    "ide/package-lock.json": "{}",
    "ide/src-tauri/Cargo.toml": '[package]\nname = "ide"\n',
    "ide/src-tauri/tauri.conf.json": "{}",
    "site/package.json": json({ scripts: { build: "astro build" }, dependencies: { astro: "4" } }),
  };
  const analyze = () => analyzeProject(fakeFs(tree, { exists: ["ide/node_modules"] }));

  it("returns every command a project has for the check, with the project they belong to", async () => {
    const selection = selectChecks(await analyze(), "typecheck", "ide");
    if (!selection.ok) throw new Error(selection.error);
    expect(selection.project.path).toBe("ide");
    expect(selection.checks.map((check) => [check.program, check.cwd])).toEqual([["npm", "ide"], ["cargo", "ide/src-tauri"]]);
    expect(selection.installNeeded).toBe(false);
  });

  it("uses the only project that has the check when no path is given", async () => {
    const single = await analyzeProject(fakeFs({ "site/package.json": json({ scripts: { build: "astro build" } }) }, { exists: ["site/node_modules"] }));
    const only = selectChecks(single, "build");
    if (!only.ok) throw new Error(only.error);
    expect(only.project.path).toBe("site");
    expect(only.checks).toHaveLength(1);
  });

  it("does not guess among projects that all have the check, the Tauri backend's cargo build included", async () => {
    expect(selectChecks(await analyze(), "build")).toEqual({ ok: false, error: "Several projects have a build check: core, ide, site. Call run_check again with path set to one of them." });
  });

  it("accepts a folder inside a project and tidies the path", async () => {
    for (const path of ["ide/src-tauri/src", "./ide/", "ide"]) {
      const selection = selectChecks(await analyze(), "test", path);
      expect(selection.ok && selection.project.path).toBe("ide");
    }
  });

  it("asks which project when several qualify, and lists them", async () => {
    expect(selectChecks(await analyze(), "test")).toEqual({ ok: false, error: "Several projects have a test check: core, ide. Call run_check again with path set to one of them." });
  });

  it("explains what is available when the project has no such check", async () => {
    const selection = selectChecks(await analyze(), "lint", "site");
    expect(selection).toEqual({
      ok: false,
      error: "No lint check was detected for site. Detected checks: site: build. Call project_info to see how it is built, and use run_command for a command it does not cover.",
    });
  });

  it("reports an unknown path and a workspace with nothing recognizable", async () => {
    expect(selectChecks(await analyze(), "test", "nowhere")).toEqual({ ok: false, error: "No project found at or above 'nowhere'. Projects here: core, ide, site." });
    const empty = await analyzeProject(fakeFs({ "notes.txt": "" }));
    expect(selectChecks(empty, "test")).toMatchObject({ ok: false, error: expect.stringContaining("No recognizable project") });
  });

  it("offers install only for a project whose dependencies are missing, and flags that for the others' checks", async () => {
    const info = await analyze();
    const site = selectChecks(info, "install", "site");
    if (!site.ok) throw new Error(site.error);
    expect(site.checks[0]).toMatchObject({ program: "npm", args: ["install"] });
    expect(selectChecks(info, "build", "site")).toMatchObject({ ok: true, installNeeded: true });
    expect(selectChecks(info, "install", "ide")).toEqual({ ok: false, error: "Nothing to install: dependencies already appear to be installed for ide." });
  });
});

describe("other ecosystems", () => {
  it("reads a uv project's test, lint and type tools, and notes the missing virtualenv", async () => {
    const pyproject = ['[project]', 'name = "svc"', 'requires-python = ">=3.11"', 'dependencies = ["fastapi"]', "[tool.uv]", "[tool.pytest.ini_options]", "[tool.ruff]", "[tool.mypy]"].join("\n");
    const info = await analyzeProject(fakeFs({ "pyproject.toml": pyproject, "uv.lock": "" }));
    const [project] = info.projects;
    expect(project.kinds).toEqual(["python (uv)", "fastapi"]);
    expect(project.name).toBe("svc");
    expect(checkFor(project, "test")).toMatchObject({ program: "uv", args: ["run", "pytest"] });
    expect(checkFor(project, "lint")).toMatchObject({ program: "uv", args: ["run", "ruff", "check", "."] });
    expect(checkFor(project, "typecheck")).toMatchObject({ args: ["run", "mypy", "."] });
    expect(checkFor(project, "install")).toMatchObject({ program: "uv", args: ["sync"] });
    expect(project.environment[0]).toMatch(/no virtual environment found/);
    expect(project.notes).toContain("Requires Python >=3.11 (pyproject.toml).");
  });

  it("does not ask for an install when a virtualenv exists", async () => {
    const info = await analyzeProject(fakeFs({ "pyproject.toml": "[tool.poetry]\nname = \"x\"\n[tool.poetry.dev-dependencies]\npytest = \"^7\"\n" }, { exists: [".venv"] }));
    const [project] = info.projects;
    expect(checkFor(project, "test")).toMatchObject({ program: "poetry", args: ["run", "pytest"] });
    expect(checkFor(project, "install")).toBeUndefined();
    expect(project.environment).toEqual(["a virtual environment exists (.venv or venv)"]);
  });

  it("runs plain pip projects through python -m pytest and installs requirements", async () => {
    const info = await analyzeProject(fakeFs({ "requirements.txt": "flask\npytest\n", "tests/test_app.py": "" }));
    const [project] = info.projects;
    expect(project.kinds).toEqual(["python (pip)", "flask"]);
    expect(checkFor(project, "test")).toMatchObject({ program: "python", args: ["-m", "pytest"] });
    expect(checkFor(project, "install")).toMatchObject({ program: "pip", args: ["install", "-r", "requirements.txt"] });
  });

  it("reads a Go module", async () => {
    const [project] = (await analyzeProject(fakeFs({ "go.mod": "module example.com/app\n\ngo 1.22\n" }))).projects;
    expect(project).toMatchObject({ name: "example.com/app", kinds: ["go"] });
    expect(project.notes).toContain("Go 1.22 (go.mod).");
    expect(checkFor(project, "test")).toMatchObject({ program: "go", args: ["test", "./..."] });
    expect(checkFor(project, "lint")).toMatchObject({ args: ["vet", "./..."] });
  });

  it("prefers a Maven or Gradle wrapper when one is present", async () => {
    const maven = (await analyzeProject(fakeFs({ "pom.xml": "", mvnw: "" }))).projects[0];
    expect(checkFor(maven, "test")).toMatchObject({ program: "./mvnw", args: ["test"] });
    const plain = (await analyzeProject(fakeFs({ "pom.xml": "" }))).projects[0];
    expect(checkFor(plain, "build")?.program).toBe("mvn");
    const gradle = (await analyzeProject(fakeFs({ "build.gradle.kts": "", gradlew: "" }))).projects[0];
    expect(gradle.kinds).toEqual(["kotlin/java (gradle)"]);
    expect(checkFor(gradle, "test")?.program).toBe("./gradlew");
  });

  it("recognizes .NET solutions and names ecosystems it cannot run commands for", async () => {
    expect((await analyzeProject(fakeFs({ "App.sln": "" }))).projects[0].kinds).toEqual([".net"]);
    const [ruby] = (await analyzeProject(fakeFs({ Gemfile: "" }))).projects;
    expect(ruby.kinds).toEqual(["ruby (bundler)"]);
    expect(ruby.checks).toEqual([]);
    expect(ruby.notes[0]).toMatch(/no commands are detected/);
  });

  it("uses Makefile targets only to fill gaps a manifest left", async () => {
    const info = await analyzeProject(fakeFs({
      "package.json": json({ scripts: { test: "vitest run" } }),
      Makefile: "build:\n\techo b\ntest:\n\techo t\nlint:\n\techo l\n.PHONY: build test lint\nCC := gcc\n",
    }, { exists: ["node_modules"] }));
    const [project] = info.projects;
    expect(project.kinds).toContain("make");
    expect(checkFor(project, "test")?.program).toBe("npm");
    expect(checkFor(project, "build")).toMatchObject({ program: "make", args: ["build"] });
    expect(checkFor(project, "lint")).toMatchObject({ program: "make", args: ["lint"] });
    expect(project.notes).toContain("Makefile targets: build, test, lint.");
  });

  it("reads justfile recipes", async () => {
    const [project] = (await analyzeProject(fakeFs({ justfile: "set shell := [\"bash\"]\ntest arg:\n  echo\ncheck:\n  echo\n" }))).projects;
    expect(project.kinds).toEqual(["just"]);
    expect(checkFor(project, "test")).toMatchObject({ program: "just", args: ["test"] });
    expect(checkFor(project, "typecheck")).toMatchObject({ program: "just", args: ["check"] });
  });
});

describe("what is scanned", () => {
  it("skips dependency, fixture and example folders and anything deeper than three folders", async () => {
    const pkg = json({ scripts: { build: "x" } });
    const info = await analyzeProject(fakeFs({
      "package.json": pkg,
      "node_modules/dep/package.json": pkg,
      "examples/demo/package.json": pkg,
      "tests/fixtures/app/package.json": pkg,
      "vendor/lib/package.json": pkg,
      "a/b/c/d/package.json": pkg,
    }, { exists: ["node_modules"] }));
    expect(info.projects.map((project) => project.path)).toEqual(["."]);
  });

  it("keeps the first twelve projects and counts the rest", async () => {
    const tree: Record<string, string> = {};
    for (let i = 0; i < 15; i += 1) tree[`pkgs/p${String(i).padStart(2, "0")}/package.json`] = json({ scripts: { build: "x" } });
    const info = await analyzeProject(fakeFs(tree, { exists: ["node_modules"] }));
    expect(info.projects).toHaveLength(12);
    expect(info.omittedProjects).toBe(3);
    const text = formatProjectInfo(info);
    expect(text).toContain("15 projects found.");
    expect(text).toContain("... and 3 more projects");
  });

  it("reports toolchain pins from the root", async () => {
    const info = await analyzeProject(fakeFs({
      ".nvmrc": "20.11.0\n",
      "rust-toolchain.toml": '[toolchain]\nchannel = "1.78.0"\n',
      ".python-version": "3.12.1\n",
    }));
    expect(info.toolchain).toEqual(["node 20.11.0 (.nvmrc)", "rust 1.78.0 (rust-toolchain.toml)", "python 3.12.1 (.python-version)"]);
  });

  it("includes what CI runs, minus anything that publishes", async () => {
    const workflow = [
      "name: CI", "jobs:", "  test:", "    steps:", "      - uses: actions/checkout@v4", "      - run: npm ci", "      - run: npm test",
      "      - name: Build", "        run: |", "          npm run build", "          echo done", "      - run: npm publish",
    ].join("\n");
    const info = await analyzeProject(fakeFs({ "package.json": webPackage, ".github/workflows/ci.yml": workflow }, { exists: ["node_modules"] }));
    expect(info.ci).toEqual([
      { file: ".github/workflows/ci.yml", commands: [{ command: "npm ci", cwd: "." }, { command: "npm test", cwd: "." }, { command: "npm run build", cwd: "." }] },
    ]);
  });

  it("includes CI from a project's own repo folder, not only the workspace root", async () => {
    const info = await analyzeProject(fakeFs({
      "app/package.json": webPackage,
      "app/.github/workflows/ci.yml": "steps:\n  - run: npm test\n  - run: npm run build",
    }, { exists: ["app/node_modules"] }));
    expect(info.ci).toEqual([
      { file: "app/.github/workflows/ci.yml", commands: [{ command: "npm test", cwd: "app" }, { command: "npm run build", cwd: "app" }] },
    ]);
    expect(info.projects.map((project) => project.path)).toEqual(["app"]);
  });

  it("puts a CI job's working-directory under its repo folder, so commands are reported where they really run", async () => {
    const workflow = [
      "jobs:",
      "  clippy:",
      "    steps:",
      "      - run: cargo clippy --workspace --all-targets -- -D warnings",
      "  typescript:",
      "    defaults:",
      "      run:",
      "        working-directory: sdk/typescript",
      "    steps:",
      "      - run: npm ci",
      "      - run: npm test",
    ].join("\n");
    const info = await analyzeProject(fakeFs({ "core/Cargo.toml": '[workspace]\nmembers = []\n', "core/.github/workflows/ci.yml": workflow }));
    expect(info.ci[0].commands).toEqual([
      { command: "cargo clippy --workspace --all-targets -- -D warnings", cwd: "core" },
      { command: "npm ci", cwd: "core/sdk/typescript" },
      { command: "npm test", cwd: "core/sdk/typescript" },
    ]);
    const text = formatProjectInfo(info);
    expect(text).toContain("    cargo clippy --workspace --all-targets -- -D warnings   cwd: core");
    expect(text).toContain("    npm test   cwd: core/sdk/typescript");
  });

  it("reads a working-directory from the CI workspace root when the repo is checked out beside others", async () => {
    // The workflow checks this repo out into a folder named for it, so `working-directory: app`
    // means <workspace>/app, not <workspace>/app/app.
    const workflow = ["jobs:", "  build:", "    defaults:", "      run:", "        working-directory: app", "    steps:", "      - run: npm ci", "      - run: npm run build"].join("\n");
    const info = await analyzeProject(fakeFs({ "app/package.json": webPackage, "app/.github/workflows/release.yml": workflow }, { exists: ["app/node_modules"] }));
    expect(info.ci[0].commands).toEqual([{ command: "npm ci", cwd: "app" }, { command: "npm run build", cwd: "app" }]);
  });

  it("flags an incomplete scan", async () => {
    const info = await analyzeProject(fakeFs({ "package.json": webPackage }, { incomplete: true, exists: ["node_modules"] }));
    expect(info.incomplete).toBe(true);
    expect(formatProjectInfo(info)).toContain("too large to scan completely");
  });

  it("survives files that cannot be read", async () => {
    const fs: ProjectFs = { files: ["package.json", "Cargo.toml"], read: async () => { throw new Error("denied"); }, exists: async () => false };
    const info = await analyzeProject(fs);
    expect(info.projects[0].kinds).toEqual(expect.arrayContaining(["node (npm)", "rust (cargo)"]));
  });
});

describe("formatProjectInfo", () => {
  const tauriTree = {
    "package.json": json({ scripts: { dev: "vite", typecheck: "tsc --noEmit", test: "vitest run", tauri: "tauri" }, dependencies: { react: "18" } }),
    "package-lock.json": "{}",
    "src-tauri/Cargo.toml": '[package]\nname = "ide"\n',
    "src-tauri/tauri.conf.json": "{}",
  };

  it("gives commands a model can pass straight to run_command, with working directories and the install warning", async () => {
    const text = formatProjectInfo(await analyzeProject(fakeFs(tauriTree)));
    expect(text).toContain("1 project found.");
    expect(text).toContain("run_check runs these by name; with run_command pass program and args separately");
    expect(text).toContain("- install: npm ci");
    expect(text).toContain("- typecheck: npm run typecheck");
    expect(text).toContain("- typecheck: cargo check   cwd: src-tauri");
    expect(text).toContain("Environment: dependencies are NOT installed");
    expect(text).toContain("- tauri dev (desktop app): npm run tauri -- dev");
    expect(text).toContain("environment problem, not a code bug");
  });

  it("orders checks install, typecheck, lint, test, build", async () => {
    const text = formatProjectInfo(await analyzeProject(fakeFs({ "package.json": webPackage, "package-lock.json": "{}" })));
    const order = ["- install:", "- typecheck:", "- lint:", "- test:", "- build:"].map((marker) => text.indexOf(marker));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("shows a project's name only when it adds something to the path", async () => {
    const rootNamed = formatProjectInfo(await analyzeProject(fakeFs({ "package.json": json({ name: "web", scripts: { build: "x" } }) }, { exists: ["node_modules"] })));
    expect(rootNamed).toContain("[1] web - workspace root");
    const samePath = formatProjectInfo(await analyzeProject(fakeFs({ "apps/web/package.json": json({ name: "web", scripts: { build: "x" } }) }, { exists: ["node_modules"] })));
    expect(samePath).toContain("[1] apps/web\n");
    expect(samePath).not.toContain("web - apps/web");
  });

  it("marks formatter checks as style only, so a failure is not read as a broken build", async () => {
    const node = await analyzeProject(fakeFs({ "package.json": json({ scripts: { "format:check": "prettier --check ." } }) }));
    expect(checkFor(node.projects[0], "format")?.note).toMatch(/style only/);
    const rust = await analyzeProject(fakeFs({ "Cargo.toml": '[package]\nname = "x"\n' }));
    expect(checkFor(rust.projects[0], "format")?.note).toMatch(/style only/);
    expect(formatProjectInfo(rust)).toContain("style only: a failure does not mean the code is broken");
  });

  it("explains an empty result and points at the other tools", () => {
    const text = formatProjectInfo({ projects: [], omittedProjects: 0, ci: [], toolchain: [], incomplete: false });
    expect(text).toContain("No recognizable project was found");
    expect(text).toContain("list_files");
  });
});

describe("formatProjectBrief", () => {
  it("is one line per project with its kinds, its check names and nothing about how to run them", async () => {
    const brief = formatProjectBrief(await analyzeProject(fakeFs({ "package.json": webPackage, "package-lock.json": "{}", "tsconfig.json": "{}" }, { exists: ["node_modules"] })));
    const lines = (brief as string).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("project_info");
    expect(lines[1]).toMatch(/^- workspace root: node \(npm\), .*; checks: typecheck, lint, test, build$/);
    expect(brief).not.toMatch(/npm run|vitest run|from package\.json/);
  });

  it("says plainly when dependencies are missing, and does not list the install as a check", async () => {
    const brief = formatProjectBrief(await analyzeProject(fakeFs({ "package.json": webPackage, "package-lock.json": "{}" }))) as string;
    expect(brief).toContain("dependencies NOT installed: call install_dependencies before any check");
    expect(brief).not.toMatch(/checks:[^;\n]*install/);
  });

  it("names each project of a workspace with several, by folder", async () => {
    const brief = formatProjectBrief(
      await analyzeProject(fakeFs({ "web/package.json": webPackage, "api/Cargo.toml": '[package]\nname = "api"\n' }, { exists: ["web/node_modules"] })),
    ) as string;
    expect(brief).toMatch(/^- web: /m);
    expect(brief).toMatch(/^- api: .*checks: /m);
  });

  it("keeps a large workspace short and says how much it left out", async () => {
    const tree: Record<string, string> = {};
    for (let index = 0; index < 9; index += 1) tree[`pkg${index}/Cargo.toml`] = `[package]\nname = "p${index}"\n`;
    const brief = formatProjectBrief(await analyzeProject(fakeFs(tree))) as string;
    expect(brief.split("\n").filter((line) => line.startsWith("- pkg"))).toHaveLength(6);
    expect(brief).toContain("- ... and 3 more projects");
  });

  it("flags an incomplete scan, and gives nothing when no project was found", async () => {
    const incomplete = formatProjectBrief(await analyzeProject(fakeFs({ "package.json": webPackage }, { incomplete: true, exists: ["node_modules"] })));
    expect(incomplete).toContain("too large to scan completely");
    expect(formatProjectBrief(await analyzeProject(fakeFs({ "notes.txt": "hello" })))).toBeUndefined();
  });
});

describe("which test runner a test check uses", () => {
  const runnerOf = async (tree: Record<string, string>) => {
    const info = await analyzeProject(fakeFs(tree, { exists: ["node_modules"] }));
    return info.projects.flatMap((project) => project.checks).find((check) => check.id === "test")?.runner;
  };
  const withTest = (script: string) => ({ "package.json": json({ scripts: { test: script }, dependencies: { a: "1" } }) });

  it("names vitest or jest from the script, wherever the runner sits in its command", async () => {
    expect(await runnerOf(withTest("vitest run"))).toBe("vitest");
    expect(await runnerOf(withTest("vitest"))).toBe("vitest");
    expect(await runnerOf(withTest("jest --coverage"))).toBe("jest");
    expect(await runnerOf(withTest("cross-env NODE_ENV=test jest"))).toBe("jest");
    expect(await runnerOf(withTest("tsc --noEmit && vitest run"))).toBe("vitest");
  });

  it("names none when a filter passed to the script would not reach the runner", async () => {
    expect(await runnerOf(withTest("vitest run && playwright test"))).toBeUndefined(); // arguments go to the last command
    expect(await runnerOf(withTest("vitest run | tee out.txt"))).toBeUndefined();
    expect(await runnerOf(withTest("npm run test:unit"))).toBeUndefined();
    expect(await runnerOf(withTest("node scripts/test.js --config jest.config.js"))).toBeUndefined();
    expect(await runnerOf(withTest("mocha"))).toBeUndefined();
  });

  it("names cargo, pytest and go for their projects, and only for the test check", async () => {
    expect(await runnerOf({ "Cargo.toml": '[package]\nname = "x"\n' })).toBe("cargo");
    expect(await runnerOf({ "pyproject.toml": "[tool.pytest.ini_options]\n", "tests/test_a.py": "" })).toBe("pytest");
    expect(await runnerOf({ "go.mod": "module x\n\ngo 1.22\n" })).toBe("go");
    const rust = await analyzeProject(fakeFs({ "Cargo.toml": '[package]\nname = "x"\n' }));
    expect(rust.projects[0].checks.filter((check) => check.id !== "test").every((check) => !("runner" in check))).toBe(true);
  });
});

describe("project_info on narrowing a test run", () => {
  it("tells a model it can run one test, only on a test command whose runner can do that", async () => {
    const known = formatProjectInfo(await analyzeProject(fakeFs({ "package.json": json({ scripts: { test: "vitest run", lint: "eslint ." } }) }, { exists: ["node_modules"] })));
    expect(known).toMatch(/- test: npm run test.*\(run_check can run one test: test_name, test_file\)/);
    expect(known).not.toMatch(/- lint: .*run one test/);
    const unknown = formatProjectInfo(await analyzeProject(fakeFs({ "package.json": json({ scripts: { test: "mocha" } }) }, { exists: ["node_modules"] })));
    expect(unknown).not.toContain("run one test");
  });
});
