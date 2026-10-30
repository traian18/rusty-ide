// ============================================================
// filters/infra/terraform.ts -- terraform, tofu and terragrunt (mapped
// to "terraform" by invocation.ts). What goes: state refresh and read
// progress, "Still creating... [10s elapsed]", state lock lines, the
// "(N unchanged attributes hidden)" notes, the legend paragraph above a
// plan, the -out advice below it, and init's provider installation steps
// and closing advice. Resource changes, the Plan:/Apply complete! summary,
// warnings and errors stay.
// ============================================================

import { matchesAny } from "../../text";
import type { CommandFilter } from "../../types";

const NOISE = [
  /^\S+: Refreshing state\.\.\./,
  /^\S+: Reading\.\.\.$/,
  /^\S+: Read complete after /,
  /^\S+: Still (creating|modifying|destroying|reading|updating)\.\.\. \[[\dhms]+ elapsed\]$/,
  /^\s*# \(\d+ unchanged (attributes?|blocks?|elements?) hidden\)$/,
  /^(Acquiring|Releasing) state lock\./,
  /^- (Finding|Installing|Installed|Reusing previous version|Using previously-installed)\b/,
  /^Initializing (the backend|provider plugins|modules)\.\.\.$/,
  /^Upgrading modules\.\.\.$/,
];

/** A paragraph (up to the next blank line) that starts with one of these is advice, not result. */
const ADVICE_PARAGRAPHS = [
  /^(Terraform|OpenTofu) used the selected providers to generate the following execution/,
  /^Note: You didn't use the -out option/,
  /^(Terraform|OpenTofu) has created a lock file/,
  /^You may now begin working with/,
  /^If you ever set or change modules or backend configuration/,
];

export const terraformFilter: CommandFilter = {
  name: "terraform",
  matches: (command) => command.tool === "terraform",
  apply: (output) => {
    const out: string[] = [];
    let inAdvice = false;
    for (const line of output.split("\n")) {
      if (inAdvice) {
        if (line.trim() === "") inAdvice = false;
        continue;
      }
      if (matchesAny(line, ADVICE_PARAGRAPHS)) {
        inAdvice = true;
        continue;
      }
      if (!matchesAny(line, NOISE)) out.push(line);
    }
    return out.join("\n");
  },
};
