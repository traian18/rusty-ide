// ============================================================
// filters/builds/jvm.ts -- Maven and Gradle, wrappers included. What goes:
// dependency download lines (counted), transfer progress, Maven's banner
// separators and empty [INFO] lines, surefire's per-class lines for
// classes that passed, Gradle's up-to-date task lines and daemon chatter.
// [ERROR], [WARNING], failing tests, plugin steps and BUILD lines stay.
// ============================================================

import { collapseMatching, dropMatching, plural } from "../../text";
import type { CommandFilter } from "../../types";

const MAVEN_NOISE = [
  /^Progress \(\d+\):/,
  /^\[INFO\]\s*$/,
  /^\[INFO\] -{20,}\s*$/,
  /^\[INFO\] Scanning for projects\.\.\.$/,
  /^\[INFO\] Running \S+$/,
  /^\[INFO\] Tests run: \d+, Failures: 0, Errors: 0, Skipped: \d+, Time elapsed: .* - in \S+$/,
];
const MAVEN_DOWNLOAD = /^(\[INFO\] )?Download(ing|ed) from \S+: /;

const GRADLE_NOISE = [
  /^> Task \S+( (UP-TO-DATE|NO-SOURCE|FROM-CACHE|SKIPPED))?$/,
  /^<[-=]+> \d+% /,
  /^Starting a Gradle Daemon/,
  /^Daemon will be stopped at the end of the build/,
  /^> Configure project /,
];
const GRADLE_DOWNLOAD = /^Download https?:\/\//;

export const mavenFilter: CommandFilter = {
  name: "maven",
  matches: (command) => command.tool === "mvn",
  apply: (output) => {
    const lines = collapseMatching(output.split("\n"), MAVEN_DOWNLOAD, (n) => `[INFO] (${plural(n, "dependency download")} hidden)`);
    return dropMatching(lines, MAVEN_NOISE).kept.join("\n");
  },
};

export const gradleFilter: CommandFilter = {
  name: "gradle",
  matches: (command) => command.tool === "gradle",
  apply: (output) => {
    const lines = collapseMatching(output.split("\n"), GRADLE_DOWNLOAD, (n) => `(${plural(n, "dependency download")} hidden)`);
    return dropMatching(lines, GRADLE_NOISE).kept.join("\n");
  },
};
