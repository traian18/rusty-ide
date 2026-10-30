// ============================================================
// commandOutput/registry.ts -- every filter, in the order they are
// tried; the first whose `matches` accepts the command shapes its output.
// Order matters where commands overlap: tests before cargo builds (`cargo
// test` compiles too), path lists before searches (`grep -l` prints paths),
// the diff filter before other git commands.
// ============================================================

import { cargoBuildFilter } from "./filters/builds/cargo";
import { gradleFilter, mavenFilter } from "./filters/builds/jvm";
import { bundlerBuildFilter, dotnetFilter, goBuildFilter } from "./filters/builds/other";
import { grepFilter } from "./filters/files/grep";
import { lsFilter } from "./filters/files/ls";
import { pathListFilter } from "./filters/files/paths";
import { gitDiffFilter } from "./filters/git/diff";
import { gitLogFilter } from "./filters/git/log";
import { gitRemoteFilter } from "./filters/git/remote";
import { gitStatusFilter } from "./filters/git/status";
import { dockerFilter } from "./filters/infra/docker";
import { ghFilter } from "./filters/infra/gh";
import { kubectlFilter } from "./filters/infra/kubectl";
import { terraformFilter } from "./filters/infra/terraform";
import { jsInstallFilter, otherInstallFilter, pipInstallFilter } from "./filters/installs/packages";
import { testRunFilter } from "./filters/tests/testRunners";
import type { CommandFilter } from "./types";

export const FILTERS: readonly CommandFilter[] = [
  // version control
  gitDiffFilter,
  gitStatusFilter,
  gitLogFilter,
  gitRemoteFilter,
  // tests, then builds
  testRunFilter,
  cargoBuildFilter,
  mavenFilter,
  gradleFilter,
  goBuildFilter,
  dotnetFilter,
  bundlerBuildFilter,
  // dependency installs
  jsInstallFilter,
  pipInstallFilter,
  otherInstallFilter,
  // infrastructure and service CLIs
  dockerFilter,
  kubectlFilter,
  terraformFilter,
  ghFilter,
  // files
  pathListFilter,
  lsFilter,
  grepFilter,
];
