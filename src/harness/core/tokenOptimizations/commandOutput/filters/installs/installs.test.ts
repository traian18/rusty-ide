import { describe, expect, it } from "vitest";
import { toInvocation } from "../../invocation";
import { jsInstallFilter, otherInstallFilter, pipInstallFilter } from "./packages";

describe("installs", () => {
  it("counts npm deprecations and drops the funding nag", () => {
    const output = [
      "npm warn deprecated inflight@1.0.6: This module is not supported",
      "npm warn deprecated glob@7.2.3: Glob versions prior to v9 are no longer supported",
      "npm warn deprecated rimraf@3.0.2: Rimraf versions prior to v4 are no longer supported",
      "",
      "added 812 packages, and audited 813 packages in 14s",
      "",
      "142 packages are looking for funding",
      "  run `npm fund` for details",
      "",
      "found 0 vulnerabilities",
    ].join("\n");
    expect(jsInstallFilter.apply(output, toInvocation("npm", ["install"], 0))!.split("\n").filter(Boolean)).toEqual([
      "npm warn deprecated: 3 packages (details hidden)",
      "added 812 packages, and audited 813 packages in 14s",
      "found 0 vulnerabilities",
    ]);
  });

  it("drops pnpm's progress and bar but keeps what was added", () => {
    const out = jsInstallFilter.apply("Progress: resolved 412, reused 400, downloaded 12, added 412, done\nPackages: +412\n++++++++++++++++++++++++++++++++\ndependencies:\n+ react 19.1.0\n\nDone in 4.2s", toInvocation("pnpm", ["add", "react"], 0))!;
    expect(out.split("\n").filter(Boolean)).toEqual(["Packages: +412", "dependencies:", "+ react 19.1.0", "Done in 4.2s"]);
  });

  it("counts pip's per-package lines and keeps the result and errors", () => {
    const output = [
      "Collecting requests",
      "  Downloading requests-2.32.3-py3-none-any.whl.metadata (4.6 kB)",
      "Collecting idna<4,>=2.5 (from requests)",
      "  Using cached idna-3.10-py3-none-any.whl.metadata (10 kB)",
      "Requirement already satisfied: certifi in ./venv/lib/python3.12/site-packages (2024.8.30)",
      "Requirement already satisfied: urllib3 in ./venv/lib/python3.12/site-packages (2.2.3)",
      "Installing collected packages: idna, requests",
      "Successfully installed idna-3.10 requests-2.32.3",
      "",
      "[notice] A new release of pip is available: 24.0 -> 24.3",
    ].join("\n");
    expect(pipInstallFilter.apply(output, toInvocation("python3", ["-m", "pip", "install", "requests"], 0))!.split("\n").filter(Boolean)).toEqual([
      "(4 download/collect lines hidden)",
      "Requirement already satisfied: 2 packages",
      "Installing collected packages: idna, requests",
      "Successfully installed idna-3.10 requests-2.32.3",
    ]);
  });

  it("counts bundler's Using lines", () => {
    const out = otherInstallFilter.apply("Fetching gem metadata from https://rubygems.org/\nUsing rake 13.2.1\nUsing rack 3.1.7\nUsing rails 7.2.1\nBundle complete! 12 Gemfile dependencies, 80 gems now installed.", toInvocation("bundle", ["install"], 0));
    expect(out).toBe("Fetching gem metadata from https://rubygems.org/\n(3 package lines hidden)\nBundle complete! 12 Gemfile dependencies, 80 gems now installed.");
  });
});
