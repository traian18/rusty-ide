// ============================================================
// goals/goalCommand.ts -- the /goal command typed in the Agent tab:
//
//   /goal [options] <instruction>   start a goal
//   /goal status | pause | resume | clear
//
// Options come before the instruction, each key=value (a value with spaces in double quotes):
//   scope=src/run.ts,src/run/**   files, folders or globs the targets are measured on
//   health=8.5                    every file in scope scores at least this (1-10)
//   severity=medium               no code health finding above low|medium|high|critical
//   checks=typecheck,test         checks that must pass (run by each pass)
//   passes=8                      passes before the goal pauses
//   guidelines=off                do not require "no guideline errors"
//   keep=all                      keep a pass even when it makes things worse
//   done="..."                    a result in words, judged once everything measured is met
// Files attached to the message are added to the scope. With no target given, the goal is
// health=8.5.
// ============================================================

export type Severity = "low" | "medium" | "high" | "critical";

export interface GoalTargets {
  minFileHealth?: number;
  maxSeverity?: Severity;
  checks: string[];
  guidelines: boolean;
  doneWhen?: string;
}

export interface GoalStart {
  kind: "start";
  instruction: string;
  scope: string[];
  targets: GoalTargets;
  maxPasses?: number;
  keepBest: boolean;
}

export type GoalCommand =
  | GoalStart
  | { kind: "status" | "pause" | "resume" | "clear" }
  | { kind: "invalid"; message: string };

export const DEFAULT_MIN_HEALTH = 8.5;
const SEVERITIES: readonly Severity[] = ["low", "medium", "high", "critical"];
const CHECKS = ["typecheck", "lint", "test", "build", "format"];
const CONTROLS = ["status", "pause", "resume", "clear"] as const;

export const GOAL_USAGE =
  "Usage: /goal [scope=paths] [health=8.5] [severity=medium] [checks=typecheck,test] [passes=8] [guidelines=off] [keep=all] [done=\"...\"] <what to do>; or /goal status | pause | resume | clear.";

export function isGoalCommand(text: string): boolean {
  return /^\/goal(\s|$)/.test(text.trim());
}

/** The next `key=value` option at the start of `rest`, and what follows it. */
function nextOption(rest: string): { key: string; value: string; rest: string } | undefined {
  const match = /^([a-z_]+)=("([^"]*)"|\S+)\s*/.exec(rest);
  if (!match) return undefined;
  return { key: match[1], value: match[3] ?? match[2], rest: rest.slice(match[0].length) };
}

function list(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function parseGoalCommand(text: string, attached: string[] = []): GoalCommand {
  let rest = text.trim().replace(/^\/goal\s*/, "");
  const control = CONTROLS.find((word) => rest === word);
  if (control) return { kind: control };
  if (!rest) return { kind: "status" };
  const start: GoalStart = { kind: "start", instruction: "", scope: [...attached], targets: { checks: [], guidelines: true }, keepBest: true };
  for (let option = nextOption(rest); option; option = nextOption(rest)) {
    rest = option.rest;
    const { key, value } = option;
    switch (key) {
      case "scope":
        start.scope.push(...list(value));
        break;
      case "health": {
        const health = Number(value);
        if (!Number.isFinite(health) || health < 1 || health > 10) return { kind: "invalid", message: "health must be a number from 1 to 10." };
        start.targets.minFileHealth = health;
        break;
      }
      case "severity":
        if (!SEVERITIES.includes(value as Severity)) return { kind: "invalid", message: `severity must be one of ${SEVERITIES.join(", ")}.` };
        start.targets.maxSeverity = value as Severity;
        break;
      case "checks": {
        const checks = list(value);
        const unknown = checks.filter((check) => !CHECKS.includes(check));
        if (unknown.length > 0) return { kind: "invalid", message: `unknown check ${unknown.join(", ")}; use ${CHECKS.join(", ")}.` };
        start.targets.checks = checks;
        break;
      }
      case "passes": {
        const passes = Number(value);
        if (!Number.isInteger(passes) || passes < 1 || passes > 50) return { kind: "invalid", message: "passes must be a whole number from 1 to 50." };
        start.maxPasses = passes;
        break;
      }
      case "guidelines":
        start.targets.guidelines = !["off", "false", "no"].includes(value.toLowerCase());
        break;
      case "keep":
        start.keepBest = value.toLowerCase() !== "all";
        break;
      case "done":
        start.targets.doneWhen = value.trim() || undefined;
        break;
      default:
        return { kind: "invalid", message: `unknown option ${key}. ${GOAL_USAGE}` };
    }
  }
  start.instruction = rest.trim();
  if (!start.instruction) return { kind: "invalid", message: `say what the goal is. ${GOAL_USAGE}` };
  const { minFileHealth, maxSeverity, checks, doneWhen } = start.targets;
  if (minFileHealth === undefined && maxSeverity === undefined && checks.length === 0 && !doneWhen) start.targets.minFileHealth = DEFAULT_MIN_HEALTH;
  start.scope = [...new Set(start.scope)];
  return start;
}
