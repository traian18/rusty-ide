// ============================================================
// filters/builds/other.ts -- the remaining build tools:
//   go       `go: downloading mod v1` lines counted (build, mod, get, vet, run)
//   bundlers a package script's build (vite, webpack, rollup, next): the
//            per-asset size table capped, transform progress dropped
//   dotnet   restore chatter dropped
// ============================================================

import { packageScript, subcommand } from "../../invocation";
import { capList, collapseMatching, dropMatching, plural } from "../../text";
import type { CommandFilter } from "../../types";

const MAX_ASSET_LINES = 12;

export const goBuildFilter: CommandFilter = {
  name: "go",
  matches: (command) => command.tool === "go" && ["build", "mod", "get", "install", "vet", "run", "generate"].includes(subcommand(command) ?? ""),
  apply: (output) => collapseMatching(output.split("\n"), /^go: downloading \S+ \S+$/, (n) => `go: downloading ${plural(n, "module")} (names hidden)`).join("\n"),
};

const ASSET_LINE = /^\s*\S+\.(m?js|cjs|css|html|map|svg|png|jpe?g|webp|gif|ico|woff2?|ttf|eot|json|wasm|txt)\s+[\d.,]+\s*(kB|KiB|MB|MiB|B|bytes)\b/;
const BUNDLER_NOISE = [/^transforming \(\d+\)/, /^rendering chunks \(\d+\)/, /^computing gzip size \(\d+\)/, /^\s*[▲○●ƒλ]?\s*Collecting page data/, /^\s*Generating static pages \(\d+\/\d+\)/];

function capAssets(lines: readonly string[]): string[] {
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    out.push(...capList(run, MAX_ASSET_LINES, (hidden) => `  ... ${plural(hidden, "more output file")}`));
    run = [];
  };
  for (const line of lines) {
    if (ASSET_LINE.test(line)) run.push(line);
    else {
      flush();
      out.push(line);
    }
  }
  flush();
  return out;
}

export const bundlerBuildFilter: CommandFilter = {
  name: "build",
  matches: (command) => /^(build|dev|preview|generate|export)(:|$)/.test(packageScript(command) ?? "") || ["vite", "webpack", "rollup", "next", "esbuild", "parcel", "tsup"].includes(command.tool),
  apply: (output) => capAssets(dropMatching(output.split("\n"), BUNDLER_NOISE).kept).join("\n"),
};

const DOTNET_NOISE = [/^\s+Determining projects to restore\.\.\.$/, /^\s+All projects are up-to-date for restore\.$/, /^\s+Restored \S+ \(in [\d.]+ m?s\)\.$/, /^MSBuild version /, /^Welcome to \.NET/];

export const dotnetFilter: CommandFilter = {
  name: "dotnet",
  matches: (command) => command.tool === "dotnet" && ["build", "restore", "publish", "run", "pack"].includes(subcommand(command) ?? ""),
  apply: (output) => dropMatching(output.split("\n"), DOTNET_NOISE).kept.join("\n"),
};
