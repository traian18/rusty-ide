// ============================================================
// commandOutput/invocation.ts -- turns the model's {program, args} into
// the Invocation filters match on, and the small argument predicates they
// share. Wrappers are unwrapped so `npx vitest`, `pnpm exec jest`,
// `python -m pytest`, `uv run pytest` and `sh -c "cargo test"` all reach
// the filter of the tool that prints the output.
// ============================================================

import type { Invocation } from "./types";

const ALIASES: Record<string, string> = { mvnw: "mvn", gradlew: "gradle", python3: "python", pip3: "pip", podman: "docker", terragrunt: "terraform", tofu: "terraform" };

/** Lower-case basename without a Windows extension, with wrapper scripts mapped to their tool. */
export function baseTool(program: string): string {
  const name = program.split(/[\\/]/).pop()!.toLowerCase().replace(/\.(exe|cmd|bat)$/, "");
  return ALIASES[name] ?? name;
}

const withoutLeadingFlags = (words: readonly string[]): string[] => {
  let i = 0;
  while (i < words.length && (words[i].startsWith("-") || words[i] === "--")) i += 1;
  return words.slice(i);
};

/**
 * The words of a shell line that is one plain command (`cargo test -q`), or
 * undefined when it pipes, chains, redirects or substitutes: then the output
 * is not one tool's, and only the generic layer applies.
 */
export function simpleCommandWords(line: string): string[] | undefined {
  if (/[|&;<>`$(){}\n]/.test(line)) return undefined;
  const words = [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
  return words.length > 0 ? words : undefined;
}

/** One wrapper peeled off `words`, or undefined when its first word is the real tool. */
function unwrap(words: readonly string[]): string[] | undefined {
  const [tool, ...rest] = words;
  if (["sh", "bash", "zsh", "dash"].includes(tool) && /^-[a-z]*c$/.test(rest[0] ?? "") && rest[1] !== undefined) return simpleCommandWords(rest[1]);
  if (tool === "npx" || tool === "bunx" || tool === "pnpx") return withoutLeadingFlags(rest);
  if (["npm", "pnpm", "yarn", "bun"].includes(tool) && ["exec", "dlx", "x"].includes(rest[0])) return withoutLeadingFlags(rest.slice(1));
  if (/^python(\d+(\.\d+)?)?$/.test(tool) && rest[0] === "-m") return rest.slice(1);
  if (["uv", "poetry", "pipenv", "pdm", "hatch"].includes(tool) && rest[0] === "run") return withoutLeadingFlags(rest.slice(1));
  if (tool === "uv" && rest[0] === "pip") return ["pip", ...rest.slice(1)];
  if (tool === "bundle" && rest[0] === "exec") return rest.slice(1);
  if (tool === "env") {
    const i = rest.findIndex((word) => !/^\w+=/.test(word) && !word.startsWith("-"));
    return i < 0 ? undefined : rest.slice(i);
  }
  return undefined;
}

export function toInvocation(program: string, args: readonly string[], exitCode: number | null): Invocation {
  let words = [baseTool(program), ...args];
  for (let depth = 0; depth < 3; depth += 1) {
    const next = unwrap(words);
    if (!next || next.length === 0) break;
    words = [baseTool(next[0]), ...next.slice(1)];
  }
  return { tool: words[0], args: words.slice(1), exitCode };
}

/** The first argument that is not a flag, skipping the values of `valueFlags` given as separate words. */
export function subcommand(command: Invocation, valueFlags: readonly string[] = []): string | undefined {
  for (let i = 0; i < command.args.length; i += 1) {
    const arg = command.args[i];
    if (arg === "--") return command.args[i + 1];
    if (!arg.startsWith("-")) return arg;
    if (valueFlags.includes(arg)) i += 1;
  }
  return undefined;
}

/** `--name`, `--name=value` or the exact short flag `-x`. */
export function hasFlag(command: Invocation, ...names: string[]): boolean {
  return command.args.some((arg) => names.some((name) => arg === name || (name.startsWith("--") && arg.startsWith(`${name}=`))));
}

/** A short flag letter, alone (`-l`) or in a cluster (`-la`). */
export function hasShortFlag(command: Invocation, letter: string): boolean {
  return command.args.some((arg) => /^-[a-zA-Z]+$/.test(arg) && arg.includes(letter));
}

const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"];

/** The package script a package-manager call runs (`npm run test`, `pnpm test`), if it runs one. */
export function packageScript(command: Invocation): string | undefined {
  if (!PACKAGE_MANAGERS.includes(command.tool)) return undefined;
  const first = subcommand(command);
  if (first === "run" || first === "run-script") return command.args[command.args.indexOf(first) + 1];
  return first;
}

export const isPackageManager = (command: Invocation): boolean => PACKAGE_MANAGERS.includes(command.tool);
