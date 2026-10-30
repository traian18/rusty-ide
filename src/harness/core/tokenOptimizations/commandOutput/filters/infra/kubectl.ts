// ============================================================
// filters/infra/kubectl.ts -- kubectl (and oc):
//   get/apply -o yaml|json   `managedFields` and the
//                            last-applied-configuration annotation go:
//                            server bookkeeping, often half the object
//   describe                 fields whose value is `<none>` go
// Tables from a plain `get` are already compact and pass through.
// ============================================================

import { subcommand } from "../../invocation";
import type { CommandFilter, Invocation } from "../../types";

const LAST_APPLIED = "kubectl.kubernetes.io/last-applied-configuration";

function outputFormat(command: Invocation): string | undefined {
  const i = command.args.findIndex((arg) => arg === "-o" || arg === "--output");
  if (i >= 0) return command.args[i + 1];
  return command.args.find((arg) => /^(-o|--output=)/.test(arg))?.replace(/^(-o=?|--output=)/, "");
}

/** Drops `managedFields:` blocks and the last-applied annotation from YAML, by indentation. */
export function stripYamlBookkeeping(yaml: string): string {
  const out: string[] = [];
  let skipDeeperThan: number | undefined;
  for (const line of yaml.split("\n")) {
    const indent = line.length - line.trimStart().length;
    if (skipDeeperThan !== undefined) {
      if (line.trim() === "" || indent > skipDeeperThan || (indent === skipDeeperThan && line.trimStart().startsWith("- "))) continue;
      skipDeeperThan = undefined;
    }
    const key = line.trimStart();
    if (key.startsWith("managedFields:") || key.startsWith(`${LAST_APPLIED}:`)) {
      skipDeeperThan = indent;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

function stripJsonBookkeeping(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripJsonBookkeeping);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "managedFields" || key === LAST_APPLIED) continue;
    out[key] = stripJsonBookkeeping(child);
  }
  return out;
}

export const kubectlFilter: CommandFilter = {
  name: "kubectl",
  matches: (command) => command.tool === "kubectl" || command.tool === "oc",
  apply: (output, command) => {
    const sub = subcommand(command);
    const format = outputFormat(command);
    if (format === "yaml") return stripYamlBookkeeping(output);
    if (format === "json") {
      try {
        return JSON.stringify(stripJsonBookkeeping(JSON.parse(output)), null, 2);
      } catch {
        return undefined;
      }
    }
    if (sub === "describe") return output.split("\n").filter((line) => !/^\s*[\w./-][\w ./-]*:\s+<none>\s*$/.test(line)).join("\n");
    return undefined;
  },
};
