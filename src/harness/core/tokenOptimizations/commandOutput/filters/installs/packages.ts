// ============================================================
// filters/installs/packages.ts -- dependency installs: npm, pnpm, yarn,
// bun, pip (and uv pip), poetry, bundler, composer. Per-package lines
// (deprecations, "Collecting x", "Using cached", "Requirement already
// satisfied", "Using rails 7.1") are counted into one line each; funding
// nags, progress bars and update notices go. What was installed, the audit
// result, conflicts and every error stay.
// ============================================================

import { isPackageManager, subcommand } from "../../invocation";
import { collapseMatching, dropMatching, plural } from "../../text";
import type { CommandFilter } from "../../types";

interface Counted {
  pattern: RegExp;
  summary: (count: number) => string;
}

const JS_INSTALL = ["install", "i", "ci", "add", "remove", "rm", "uninstall", "update", "up", "upgrade", "dedupe", "prune", "link"];

const JS_NOISE = [
  /^\d+ packages? (is|are) looking for funding$/,
  /^\s+run `npm fund` for details$/,
  /^npm (notice|NOTICE)\b/,
  /^Progress: resolved \d+/,
  /^[+-]{8,}$/,
  /^\[\d\/\d\] /,
  /^info (No lockfile found|There appears to be trouble|Fetching packages|Visit https:\/\/|Linking dependencies)/,
  /^➤ YN0000: (?!.*(Done|Failed))/,
  /^(Resolving|Downloading|Saved lockfile|Already up to date|Lockfile is up to date)/,
];
const JS_COUNTED: Counted[] = [
  { pattern: /^npm (warn|WARN) deprecated /, summary: (n) => `npm warn deprecated: ${plural(n, "package")} (details hidden)` },
  { pattern: /^warning .* (has unmet|has incorrect) peer dependency/, summary: (n) => `warning: ${plural(n, "peer dependency warning")} (details hidden)` },
  { pattern: /^\s*WARN\s+deprecated /, summary: (n) => `WARN deprecated: ${plural(n, "package")} (details hidden)` },
];

const PIP_NOISE = [
  /^\s*(Obtaining|Preparing metadata|Building wheel|Created wheel|Stored in directory|Installing build dependencies|Getting requirements to build|Installing backend dependencies|Checking if build backend)\b/,
  /^\s*━+/,
  /^\s*\|[█▌ ]*\|/,
  /^(WARNING: You are using pip version|You should consider upgrading via)/,
  /^\[notice\] /,
];
const PIP_COUNTED: Counted[] = [
  { pattern: /^\s*(Collecting|Downloading|Using cached) \S/, summary: (n) => `(${plural(n, "download/collect line")} hidden)` },
  { pattern: /^Requirement already satisfied: /, summary: (n) => `Requirement already satisfied: ${plural(n, "package")}` },
];

const OTHER_COUNTED: Counted[] = [
  { pattern: /^\s*(Using|Fetching|Installing) \S+ \(?[\d.]+/, summary: (n) => `(${plural(n, "package line")} hidden)` },
  { pattern: /^\s+- (Installing|Updating|Downloading|Removing) \S+ \(/, summary: (n) => `  (${plural(n, "package operation")} hidden)` },
];
const OTHER_NOISE = [/^\s*- Downloading /, /^Resolving dependencies\.\.\.$/];

function condense(output: string, noise: readonly RegExp[], counted: readonly Counted[]): string {
  let lines = dropMatching(output.split("\n"), noise).kept;
  for (const { pattern, summary } of counted) lines = collapseMatching(lines, pattern, summary, 2);
  return lines.join("\n");
}

export const jsInstallFilter: CommandFilter = {
  name: "install",
  matches: (command) => isPackageManager(command) && (JS_INSTALL.includes(subcommand(command) ?? "") || command.args.length === 0),
  apply: (output) => condense(output, JS_NOISE, JS_COUNTED),
};

export const pipInstallFilter: CommandFilter = {
  name: "pip",
  matches: (command) => (command.tool === "pip" && ["install", "download", "wheel", "sync"].includes(subcommand(command) ?? "")) || (command.tool === "uv" && ["sync", "add", "lock"].includes(subcommand(command) ?? "")),
  apply: (output) => condense(output, PIP_NOISE, PIP_COUNTED),
};

export const otherInstallFilter: CommandFilter = {
  name: "install",
  matches: (command) => ["bundle", "poetry", "composer", "pdm", "pipenv"].includes(command.tool) && ["install", "update", "add", "lock", "sync", "require", undefined].includes(subcommand(command)),
  apply: (output) => condense(output, OTHER_NOISE, OTHER_COUNTED),
};
