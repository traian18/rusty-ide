// ============================================================
// commandPolicy.ts — Risk classification and session-grant scoping for
// agent-initiated commands. Ported from the removed sidecar's
// agent-sidecar/src/services/commandPermissions.ts (HARNESS_CONTRACT_PLAN.md
// decision 4: "command-permission session-grant memory moves IDE-side"),
// minus the Node-only bits (`node:path`, `process.platform`) so it runs in
// the browser bundle.
//
// Pure functions over a NormalizedCommand -- no state. The grant memory
// itself (which keys a session has already approved) lives in
// src/services/commandPermissionService.ts, which uses `commandGrantKey`
// from here to decide whether a request can skip the dialog.
//
// The rules, unchanged from the sidecar:
//  - Risk is classified by the *operation*, not arbitrary operands: a grep
//    for the word "deploy" is still only a search.
//  - A normal-risk, directly executed program receives an executable-level
//    grant inside one session, so approving `grep` once also covers another
//    `grep` pattern in that session.
//  - Elevated/destructive commands, interpreters, and command dispatchers
//    (`sh -c`, `npm run`, `python`, ...) keep exact-command grants: their
//    real risk can't be inferred from the outer argv, so any argument
//    change asks again.
// ============================================================

import type { CommandRisk, CommandSessionGrantScope } from "./contract";

export interface NormalizedCommand {
  program: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}

const READ_ONLY_PROGRAMS = new Set([
  "ack", "ag", "basename", "cat", "cmp", "cut", "df", "diff", "dirname",
  "du", "file", "grep", "head", "ls", "pwd", "readlink", "realpath", "rg",
  "stat", "tail", "tree", "tr", "wc", "where", "whereis", "which",
]);

// These programs interpret arguments as code or dispatch to another executable.
// Their risk cannot be reliably inferred from the outer argv, so argument
// changes must always receive a separate grant.
const EXACT_GRANT_PROGRAMS = new Set([
  "awk", "bash", "bun", "bunx", "cargo", "cmd", "deno", "env", "fish", "go",
  "java", "just", "make", "node", "npx", "npm", "osascript", "perl", "php",
  "pnpm", "powershell", "pwsh", "ruby", "sh", "sudo", "task", "xargs", "yarn",
  "zsh",
]);

function isWindowsPath(value: string): boolean {
  return value.includes("\\") || /^[a-zA-Z]:/.test(value);
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value);
}

function basename(value: string): string {
  const trimmed = value.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index === -1 ? trimmed : trimmed.slice(index + 1);
}

/** Lexical `path.resolve(base, value)` for a base that is already absolute:
 * joins, then collapses `.`/`..`/duplicate separators. Never touches the
 * filesystem (no symlink resolution) -- see normalizeCommand's own note in
 * core/definitions/runCommandTool.ts on why that is an accepted limit. */
export function resolvePath(base: string, value: string): string {
  const windows = isWindowsPath(base) || isWindowsPath(value);
  const sep = windows ? "\\" : "/";
  const joined = isAbsolutePath(value) ? value : `${base}${sep}${value}`;
  const normalizedSeps = windows ? joined.replace(/\//g, "\\") : joined;
  const driveMatch = windows ? /^([a-zA-Z]:)/.exec(normalizedSeps) : null;
  const drive = driveMatch ? driveMatch[1] : "";
  const rest = normalizedSeps.slice(drive.length);
  const segments: string[] = [];
  for (const segment of rest.split(/[\\/]/)) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `${drive}${sep}${segments.join(sep)}`;
}

/** The executable's own name, lowercased and without a Windows `.exe`
 * suffix -- the key every classification rule below matches on. */
export function programName(command: Pick<NormalizedCommand, "program">): string {
  return basename(command.program).toLowerCase().replace(/\.exe$/, "");
}

function firstPositionalArg(args: string[]): string {
  return (args.find((arg) => arg && !arg.startsWith("-")) || "").toLowerCase();
}

function includesArg(args: string[], ...values: string[]): boolean {
  const expected = new Set(values);
  return args.some((arg) => expected.has(arg.toLowerCase()));
}

export function commandSignature(command: NormalizedCommand): string {
  return JSON.stringify([command.program, command.args, command.cwd]);
}

export function commandExecutableSignature(command: NormalizedCommand): string {
  const usesPath = isAbsolutePath(command.program) || command.program.includes("/") || command.program.includes("\\");
  let identity = usesPath ? resolvePath(command.cwd, command.program) : command.program;
  if (isWindowsPath(identity)) identity = identity.toLowerCase();
  return JSON.stringify([identity]);
}

/** Classify operations rather than arbitrary operands such as grep patterns. */
export function classifyCommandRisk(command: NormalizedCommand): CommandRisk {
  const program = programName(command);
  const args = command.args.map((arg) => arg.toLowerCase());
  const action = firstPositionalArg(args);

  // A search for the word "deploy" is still only a search.
  if (READ_ONLY_PROGRAMS.has(program)) return "normal";

  if (program === "find") {
    if (includesArg(args, "-delete")) return "destructive";
    if (includesArg(args, "-exec", "-execdir", "-ok", "-okdir")) return "elevated";
    return "normal";
  }

  if (program === "sed") {
    return args.some((arg) => /^--in-place(?:=|$)/.test(arg) || /^-[^-]*i/.test(arg)) ? "elevated" : "normal";
  }

  if (program === "git") {
    if (["push", "reset", "clean", "rebase"].includes(action)) return "destructive";
    if (action === "branch" && (args.some((arg) => /^-[dD]$/.test(arg)) || includesArg(args, "--delete"))) return "destructive";
    if (action === "tag" && includesArg(args, "-d", "--delete")) return "destructive";
    if (action === "stash" && includesArg(args, "drop", "clear")) return "destructive";
    if ([
      "blame", "cat-file", "describe", "diff", "grep", "log", "ls-files", "ls-tree",
      "rev-parse", "shortlog", "show", "status", "version", "whatchanged",
    ].includes(action)) return "normal";
    if (!action || (action === "branch" && !includesArg(args, "-m", "-c"))) return "normal";
    return "elevated";
  }

  if (["npm", "pnpm", "yarn", "bun", "npx", "bunx"].includes(program)) {
    if (["publish", "unpublish", "deprecate"].includes(action)) return "destructive";
    if (["list", "ls", "view", "info", "outdated", "why", "help", "version"].includes(action)) return "normal";
    return "elevated";
  }

  if (["terraform", "terragrunt"].includes(program)) {
    if (["apply", "destroy", "import"].includes(action)) return "destructive";
    if (["fmt", "get", "graph", "output", "plan", "providers", "show", "validate", "version"].includes(action)) return "normal";
    return "elevated";
  }

  if (program === "kubectl") {
    if (["delete", "drain", "replace", "rollout", "scale"].includes(action)) return "destructive";
    if (["apply", "attach", "autoscale", "cordon", "create", "edit", "exec", "expose", "label", "patch", "port-forward", "run", "set", "taint", "uncordon"].includes(action)) return "elevated";
    if (["api-resources", "api-versions", "auth", "cluster-info", "describe", "diff", "explain", "get", "logs", "top", "version", "wait"].includes(action)) return "normal";
    return "elevated";
  }

  const text = [program, ...args].join(" ");
  if (/\b(destroy|apply|delete|remove|rm|push|publish|deploy|terminate|uninstall)\b/.test(text)) return "destructive";
  if (/\b(install|update|upgrade|migrate|import|init|write|create)\b/.test(text)) return "elevated";
  return "normal";
}

function requiresExactGrant(command: NormalizedCommand): boolean {
  const program = programName(command);
  return EXACT_GRANT_PROGRAMS.has(program) || /^python(?:\d+(?:\.\d+)*)?$/.test(program);
}

export function commandSessionGrantScope(
  command: NormalizedCommand,
  risk = classifyCommandRisk(command),
): CommandSessionGrantScope {
  return risk === "normal" && !requiresExactGrant(command) ? "executable" : "exact_command";
}

/** The key a session grant is stored under: every command with the same
 * key is covered by one "allow this session" decision. Takes the scope
 * (not the risk, as the sidecar's did) because a CommandPermissionRequest
 * already carries its computed `sessionGrantScope`, and the grant memory
 * must key on exactly what the dialog told the user it was granting. */
export function commandGrantKey(
  command: NormalizedCommand,
  scope: CommandSessionGrantScope = commandSessionGrantScope(command),
): string {
  return scope === "executable"
    ? `executable:${commandExecutableSignature(command)}`
    : `exact:${commandSignature(command)}`;
}
