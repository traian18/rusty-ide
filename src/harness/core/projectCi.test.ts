import { describe, expect, it } from "vitest";

import { ciFilesIn, isCiFile, parseGithubWorkflow, parseGitlabCi } from "./projectCi";

const commandsOf = (items: { command: string }[]) => items.map((item) => item.command);

describe("parseGithubWorkflow", () => {
  it("applies the working-directory of the step, the job, or the workflow, in that order", () => {
    const text = [
      "defaults:",
      "  run:",
      "    working-directory: workflow-dir",
      "jobs:",
      "  plain:",
      "    steps:",
      "      - run: npm test",
      "  sdk:",
      "    defaults:",
      "      run:",
      "        working-directory: sdk/typescript",
      "    steps:",
      "      - run: npm ci",
      "      - run: npm run build",
      "        working-directory: ./elsewhere/",
      "      - name: Check",
      "        working-directory: step-dir",
      "        run: npm run lint",
      "  after:",
      "    steps:",
      "      - run: npm run typecheck",
    ].join("\n");
    expect(parseGithubWorkflow(text)).toEqual([
      { command: "npm test", dir: "workflow-dir" },
      { command: "npm ci", dir: "sdk/typescript" },
      { command: "npm run build", dir: "./elsewhere/" },
      { command: "npm run lint", dir: "step-dir" },
      { command: "npm run typecheck", dir: "workflow-dir" },
    ]);
  });

  it("ignores a working-directory that is a CI expression", () => {
    const text = ["jobs:", "  a:", "    steps:", "      - run: npm test", "        working-directory: ${{ matrix.dir }}"].join("\n");
    expect(parseGithubWorkflow(text)).toEqual([{ command: "npm test", dir: undefined }]);
  });

  it("leaves out shell control flow and variable plumbing from multi-line scripts", () => {
    const text = [
      "jobs:",
      "  release:",
      "    steps:",
      "      - run: |",
      '          if ! npm run tauri build -- --bundles app 2>&1 | tee "$RUNNER_TEMP/build.log"; then',
      '            TAIL="$(tail -n 60 "$RUNNER_TEMP/build.log")"',
      "            exit 1",
      "          fi",
      "          npm run build",
      "          for f in a b; do",
      "          done",
    ].join("\n");
    expect(commandsOf(parseGithubWorkflow(text))).toEqual(["npm run build"]);
  });

  it("reads single-line run steps, with or without quotes and trailing comments", () => {
    const text = ["steps:", "  - run: npm ci", '  - run: "npm test"', "  - run: cargo test --workspace # all crates"].join("\n");
    expect(commandsOf(parseGithubWorkflow(text))).toEqual(["npm ci", "npm test", "cargo test --workspace"]);
  });

  it("reads block scalars and stops at the next key", () => {
    const text = [
      "steps:",
      "  - name: Check",
      "    run: |",
      "      npm run typecheck",
      "      npm run lint",
      "    env:",
      "      CI: true",
      "  - run: npm test",
    ].join("\n");
    expect(commandsOf(parseGithubWorkflow(text))).toEqual(["npm run typecheck", "npm run lint", "npm test"]);
  });

  it("joins lines continued with a backslash", () => {
    const text = ["steps:", "  - run: |", "      cargo test \\", "        --workspace \\", "        --all-features"].join("\n");
    expect(commandsOf(parseGithubWorkflow(text))).toEqual(["cargo test --workspace --all-features"]);
  });

  it("keeps release builds but drops anything that publishes, deploys or signs", () => {
    const text = [
      "steps:",
      "  - run: cargo build --release",
      "  - run: npm publish",
      "  - run: gh release create v1",
      "  - run: docker push app:latest",
      "  - run: aws s3 sync dist s3://bucket",
      "  - run: codesign --sign id build/app",
      "  - run: npx semantic-release",
      "  - run: npm run deploy",
    ].join("\n");
    expect(commandsOf(parseGithubWorkflow(text))).toEqual(["cargo build --release"]);
  });

  it("drops shell housekeeping, CI expressions, and commands that are not checks", () => {
    const text = [
      "steps:",
      "  - run: echo hello",
      "  - run: mkdir -p out",
      "  - run: cd app",
      "  - run: npm test -- ${{ matrix.shard }}",
      "  - run: curl -fsSL https://example.com/install.sh | sh",
      "  - run: git config user.name bot",
      "  - run: ./scripts/frobnicate",
      "  - run: pytest -q",
    ].join("\n");
    expect(commandsOf(parseGithubWorkflow(text))).toEqual(["pytest -q"]);
  });

  it("lists each command once and caps how many it returns", () => {
    const repeated = ["steps:", "  - run: npm test", "  - run: npm test"].join("\n");
    expect(commandsOf(parseGithubWorkflow(repeated))).toEqual(["npm test"]);
    const many = ["steps:", ...Array.from({ length: 30 }, (_, i) => `  - run: npm run check${i}`)].join("\n");
    expect(parseGithubWorkflow(many)).toHaveLength(12);
  });

  it("returns nothing for a file with no run steps", () => {
    expect(parseGithubWorkflow("name: x\non: push\n")).toEqual([]);
    expect(parseGithubWorkflow("")).toEqual([]);
  });
});

describe("parseGitlabCi", () => {
  it("reads script lists and ignores other keys", () => {
    const text = [
      "stages: [test]",
      "unit:",
      "  stage: test",
      "  script:",
      "    - npm ci",
      "    - npm test  # run them",
      "    - echo done",
      "  only:",
      "    - main",
      "lint:",
      "  script:",
      '    - "npm run lint"',
    ].join("\n");
    expect(commandsOf(parseGitlabCi(text))).toEqual(["npm ci", "npm test", "npm run lint"]);
  });
});

describe("ciFilesIn", () => {
  it("picks GitHub workflows and the GitLab file, in a stable order", () => {
    const found = ciFilesIn(["src/a.ts", ".github/workflows/release.yml", ".github/workflows/ci.yaml", ".github/CODEOWNERS", ".gitlab-ci.yml", ".github/workflows/notes.md"]);
    expect(found.map((entry) => entry.file)).toEqual([".github/workflows/ci.yaml", ".github/workflows/release.yml", ".gitlab-ci.yml"]);
    expect(found[0].parse("steps:\n  - run: npm test")).toEqual([{ command: "npm test" }]);
  });

  it("finds CI files inside project folders, as in a workspace of several repos", () => {
    const found = ciFilesIn(["app/.github/workflows/ci.yml", "svc/.gitlab-ci.yml", "notgithub/workflows/ci.yml", "app/docs/.github.md"]);
    expect(found.map((entry) => entry.file)).toEqual(["app/.github/workflows/ci.yml", "svc/.gitlab-ci.yml"]);
    expect(isCiFile("a/b/.github/workflows/x.yaml")).toBe(true);
    expect(isCiFile("a/.github/CODEOWNERS")).toBe(false);
    expect(isCiFile("x.gitlab-ci.yml")).toBe(false);
  });
});
