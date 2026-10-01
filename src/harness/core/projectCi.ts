// ============================================================
// projectCi.ts -- the shell commands a project's CI runs, which are the most
// reliable statement of how that project is built and checked. A deliberately
// small line scanner for GitHub Actions and GitLab CI (no YAML dependency):
// it only needs `run:` / `script:` bodies, and it drops anything that
// publishes, deploys or signs, since `project_info` suggests commands a model
// may go on to run.
// ============================================================

const MAX_COMMANDS_PER_FILE = 12;

const TRIVIAL = /^(echo|cd|mkdir|ls|cat|pwd|set|export|printf|test|\[|exit|sleep|rm|cp|mv|chmod|curl|wget|sudo|apt|apt-get|brew|git|gh|tar|zip|unzip|source|touch|which|env|uname)\b/i;
const PUBLISHES = /\b(publish|deploy|upload|notari[sz]e|codesign|signtool|twine|semantic-release|release-it|docker\s+(push|login)|npm\s+login|az|aws|gcloud|kubectl|terraform|helm)\b|cargo\s+release|\bgh\s/i;
const CHECK_LIKE = /\b(test|tests|build|lint|check|clippy|tsc|typecheck|vitest|jest|pytest|mypy|ruff|fmt|verify|compile|ci)\b|^(cargo|npm|pnpm|yarn|bun|make|gradle|\.\/gradlew|mvn|\.\/mvnw|go|dotnet|pip|poetry|uv|just|task)\b/i;

/** A command CI runs. */
export interface CiCommand {
  command: string;
  /** The working directory the workflow sets for it, relative to the repository root. */
  dir?: string;
}

/** Shell control flow and variable plumbing: lines of a longer script, never a
 * command that means anything on its own. */
const SHELL_PLUMBING = /^(if|then|else|elif|fi|for|while|until|do|done|case|esac|function|\{|\}|\()(\s|$)|^[A-Za-z_][A-Za-z0-9_]*=|\$\(|`|\$\{?(GITHUB|RUNNER)_/;

function unquote(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];
  return (quote === '"' || quote === "'") && trimmed.endsWith(quote) && trimmed.length > 1 ? trimmed.slice(1, -1) : trimmed;
}

/** Whether `command` is one a model could sensibly run to check the project. */
function isUsefulCommand(command: string): boolean {
  if (!command || command.startsWith("#")) return false;
  // `${{ ... }}` is a CI expression, not something a shell can run as written.
  if (command.includes("${{")) return false;
  if (SHELL_PLUMBING.test(command)) return false;
  if (TRIVIAL.test(command) || PUBLISHES.test(command)) return false;
  return CHECK_LIKE.test(command);
}

/** Joins lines ending in a backslash, then keeps the useful commands once each. */
function tidy(lines: string[]): string[] {
  const joined: string[] = [];
  let pending = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.endsWith("\\")) {
      pending += `${line.slice(0, -1).trim()} `;
      continue;
    }
    joined.push(`${pending}${line}`.trim());
    pending = "";
  }
  if (pending.trim()) joined.push(pending.trim());
  return [...new Set(joined.filter(isUsefulCommand))].slice(0, MAX_COMMANDS_PER_FILE);
}

const indentOf = (line: string) => line.length - line.trimStart().length;

/** A `working-directory:` value, unless it is a CI expression. */
function directoryOf(value: string): string | undefined {
  const dir = unquote(value.replace(/\s+#.*$/, ""));
  return dir && !dir.includes("${{") ? dir : undefined;
}

/**
 * The `run:` commands of a GitHub Actions workflow, each with the
 * `working-directory` that applies to it: a step's own, else its job's
 * (`defaults.run`), else the workflow's. Without that a command like
 * `npm test` would be reported as running at the repository root when the job
 * runs it in a subfolder. Assumes the usual two-space layout for job names.
 */
export function parseGithubWorkflow(text: string): CiCommand[] {
  const lines = text.split(/\r?\n/);
  const found: CiCommand[] = [];
  let seenJobs = false;
  let workflowDir: string | undefined;
  let jobDir: string | undefined;
  let inSteps = false;
  let stepColumn = -1;
  let stepRuns: string[] = [];
  let stepDir: string | undefined;

  const endStep = () => {
    for (const command of tidy(stepRuns)) found.push({ command, dir: stepDir ?? jobDir });
    stepRuns = [];
    stepDir = undefined;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;

    if (/^jobs:\s*$/.test(line)) {
      seenJobs = true;
      continue;
    }
    // A job starts with no steps and the workflow's default directory.
    if (seenJobs && /^ {2}[A-Za-z0-9_.-]+:\s*$/.test(line)) {
      endStep();
      jobDir = workflowDir;
      inSteps = false;
      stepColumn = -1;
      continue;
    }
    if (/^\s*steps:\s*$/.test(line)) {
      endStep();
      inSteps = true;
      stepColumn = -1;
      continue;
    }
    if (inSteps && /^\s*-\s/.test(line)) {
      if (stepColumn < 0) stepColumn = indentOf(line);
      if (indentOf(line) === stepColumn) endStep();
    }

    const dir = /^\s*(?:-\s+)?working-directory:\s*(.+?)\s*$/.exec(line);
    if (dir) {
      if (inSteps) stepDir = directoryOf(dir[1]);
      else if (seenJobs) jobDir = directoryOf(dir[1]);
      else workflowDir = directoryOf(dir[1]);
      continue;
    }

    const run = /^(\s*)(-\s+)?run:\s*(.*)$/.exec(line);
    if (!run) continue;
    const keyColumn = run[1].length + (run[2]?.length ?? 0);
    const value = run[3].trim();
    if (/^[|>][+-]?\d*\s*(#.*)?$/.test(value)) {
      for (let j = i + 1; j < lines.length; j += 1) {
        const body = lines[j];
        if (body.trim() !== "" && indentOf(body) <= keyColumn) break;
        stepRuns.push(body);
        i = j;
      }
    } else if (value) {
      stepRuns.push(unquote(value.replace(/\s+#.*$/, "")));
    }
  }
  endStep();

  const seen = new Set<string>();
  return found
    .filter((item) => {
      const key = `${item.dir ?? ""}|${item.command}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_COMMANDS_PER_FILE);
}

/** The `script:` commands of a GitLab CI file. */
export function parseGitlabCi(text: string): CiCommand[] {
  const lines = text.split(/\r?\n/);
  const commands: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(\s*)script:\s*$/.exec(lines[i]);
    if (!match) continue;
    const keyColumn = match[1].length;
    for (let j = i + 1; j < lines.length; j += 1) {
      const body = lines[j];
      if (body.trim() !== "" && indentOf(body) <= keyColumn) break;
      const item = /^\s*-\s+(.*)$/.exec(body);
      if (item) commands.push(unquote(item[1].replace(/\s+#.*$/, "")));
      i = j;
    }
  }
  return tidy(commands).map((command) => ({ command }));
}

/** A CI file, at the workspace root or inside any project folder (a workspace
 * of several repos has a `.github` per repo). */
export const isCiFile = (file: string) => /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(file) || /(^|\/)\.gitlab-ci\.yml$/.test(file);

/** Which CI files `files` holds, and how to read each. */
export function ciFilesIn(files: string[]): { file: string; parse: (text: string) => CiCommand[] }[] {
  const found: { file: string; parse: (text: string) => CiCommand[] }[] = [];
  for (const file of files) {
    if (/(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(file)) found.push({ file, parse: parseGithubWorkflow });
    else if (/(^|\/)\.gitlab-ci\.yml$/.test(file)) found.push({ file, parse: parseGitlabCi });
  }
  return found.sort((a, b) => a.file.localeCompare(b.file));
}
