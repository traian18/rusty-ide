// ============================================================
// filters/infra/docker.ts -- docker (and podman), compose included:
//   ps / container ls   COMMAND and CREATED columns dropped
//   images / image ls   CREATED column dropped
//   build               BuildKit transfer, cache and export lines, and the
//                       legacy builder's intermediate-container lines
//   pull / compose pull / compose up
//                       per-layer download progress
// A --format or --quiet call already chose its own output.
// ============================================================

import { hasFlag } from "../../invocation";
import { dropMatching } from "../../text";
import { dropColumns } from "../../table";
import type { CommandFilter, Invocation } from "../../types";

/** The docker action, looking through `container`/`image`/`compose`/`buildx` groups. */
function action(command: Invocation): string {
  const words = command.args.filter((arg) => !arg.startsWith("-"));
  const [first, second] = words;
  if (["container", "image", "buildx", "builder"].includes(first ?? "")) return `${first} ${second ?? ""}`.trim();
  // `compose -f a.yml up`: the file is a word too, so look for the action itself.
  if (first === "compose") return `compose ${words.slice(1).find((word) => /^(up|pull|build|create|ps|logs|run)$/.test(word)) ?? ""}`.trim();
  return first ?? "";
}

const BUILD_NOISE = [
  /^#\d+ (sha256:[0-9a-f]+ [\d.]+[kMG]?B \/|transferring |extracting sha256:|resolve |DONE [\d.]+s$|CACHED$|naming to |writing image |exporting (layers|manifest|config|attestation)|unpacking to )/,
  /^#\d+ \[internal\] /,
  /^#\d+ (load (build definition|\.dockerignore|metadata)|\[auth\])/,
  /^ ---> [0-9a-f]{6,}$/,
  /^ ---> (Running in|Using cache)\b/,
  /^Removing intermediate container /,
];
const PULL_NOISE = [
  /^[0-9a-f]{12}: (Pulling fs layer|Waiting|Downloading|Verifying Checksum|Download complete|Extracting|Pull complete|Already exists)/,
  /^\s*[✔⠿⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] [0-9a-f]{12} (Pulling fs layer|Waiting|Downloading|Verifying Checksum|Download complete|Extracting|Pull complete|Already exists)/,
];

const listsChosenFormat = (command: Invocation) => hasFlag(command, "--format", "-q", "--quiet", "--no-trunc");

export const dockerFilter: CommandFilter = {
  name: "docker",
  matches: (command) => command.tool === "docker",
  apply: (output, command) => {
    const act = action(command);
    if (["ps", "container ls", "container list"].includes(act)) return listsChosenFormat(command) ? undefined : dropColumns(output, ["COMMAND", "CREATED"]);
    if (["images", "image ls", "image list"].includes(act)) return listsChosenFormat(command) ? undefined : dropColumns(output, ["CREATED"]);
    if (/(^|\s)build$|^buildx bake$|^compose build$/.test(act)) return dropMatching(output.split("\n"), BUILD_NOISE).kept.join("\n");
    if (["pull", "image pull", "compose pull", "compose up", "compose create", "run"].includes(act)) return dropMatching(output.split("\n"), PULL_NOISE).kept.join("\n");
    return undefined;
  },
};
