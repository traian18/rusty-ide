import { describe, expect, it } from "vitest";

import {
  classifyCommandRisk,
  commandExecutableSignature,
  commandGrantKey,
  commandSessionGrantScope,
  programName,
  resolvePath,
  type NormalizedCommand,
} from "./commandPolicy";

function command(program: string, args: string[] = [], cwd = "/workspace"): NormalizedCommand {
  return { program, args, cwd, timeoutMs: 5_000 };
}

// The first seven cases are the removed sidecar's own
// commandPermissions.test.ts, ported verbatim so the IDE-side policy is
// provably the same one the sidecar enforced.
describe("commandPolicy", () => {
  it("normal grep commands share an executable-level session grant", () => {
    const first = command("grep", ["-r", "TimeEntryService", "."]);
    const second = command("grep", ["-n", "another pattern", "src"]);

    expect(classifyCommandRisk(first)).toBe("normal");
    expect(commandSessionGrantScope(first)).toBe("executable");
    expect(commandGrantKey(first)).toBe(commandGrantKey(second));
  });

  it("risk words used as grep patterns do not elevate a read-only command", () => {
    const search = command("rg", ["destroy|deploy|rm", "src"]);

    expect(classifyCommandRisk(search)).toBe("normal");
    expect(commandSessionGrantScope(search)).toBe("executable");
  });

  it("read-only sed flags stay normal while in-place edits ask separately", () => {
    const print = command("sed", ["--silent", "1,5p", "README.md"]);
    const edit = command("sed", ["-i.bak", "s/old/new/g", "README.md"]);

    expect(classifyCommandRisk(print)).toBe("normal");
    expect(commandSessionGrantScope(print)).toBe("executable");
    expect(classifyCommandRisk(edit)).toBe("elevated");
    expect(commandSessionGrantScope(edit)).toBe("exact_command");
  });

  it("a destructive variant does not inherit a normal executable grant", () => {
    const status = command("git", ["status", "--short"]);
    const push = command("git", ["push", "--force", "origin", "main"]);

    expect(classifyCommandRisk(status)).toBe("normal");
    expect(commandSessionGrantScope(status)).toBe("executable");
    expect(classifyCommandRisk(push)).toBe("destructive");
    expect(commandSessionGrantScope(push)).toBe("exact_command");
    expect(commandGrantKey(status)).not.toBe(commandGrantKey(push));
  });

  it("destructive long-form git flags do not inherit a normal git grant", () => {
    const status = command("git", ["status"]);
    const deleteBranch = command("git", ["branch", "--delete", "old-branch"]);

    expect(classifyCommandRisk(deleteBranch)).toBe("destructive");
    expect(commandGrantKey(status)).not.toBe(commandGrantKey(deleteBranch));
  });

  it("interpreters retain exact-command grants even for normal-risk invocations", () => {
    const first = command("bash", ["-c", "printf hello"]);
    const second = command("bash", ["-c", "printf goodbye"]);

    expect(commandSessionGrantScope(first)).toBe("exact_command");
    expect(commandGrantKey(first)).not.toBe(commandGrantKey(second));
  });

  it("higher-risk commands only reuse an identical command grant", () => {
    const first = command("git", ["push", "origin", "main"]);
    const same = command("git", ["push", "origin", "main"], "/workspace");
    const changed = command("git", ["push", "--force", "origin", "main"]);

    expect(commandGrantKey(first)).toBe(commandGrantKey(same));
    expect(commandGrantKey(first)).not.toBe(commandGrantKey(changed));
  });

  it("package managers: read-only subcommands are normal, installs elevated, publish destructive", () => {
    expect(classifyCommandRisk(command("npm", ["ls"]))).toBe("normal");
    expect(classifyCommandRisk(command("npm", ["install", "zod"]))).toBe("elevated");
    expect(classifyCommandRisk(command("npm", ["test"]))).toBe("elevated");
    expect(classifyCommandRisk(command("npm", ["publish"]))).toBe("destructive");
    // Dispatchers never get an executable-level grant, even when normal.
    expect(commandSessionGrantScope(command("npm", ["ls"]))).toBe("exact_command");
  });

  it("python interpreters of any version are exact-grant", () => {
    expect(commandSessionGrantScope(command("python", ["-c", "print(1)"]))).toBe("exact_command");
    expect(commandSessionGrantScope(command("python3.12", ["script.py"]))).toBe("exact_command");
  });

  it("an unknown program falls back to keyword classification of its argv", () => {
    expect(classifyCommandRisk(command("mytool", ["--dry-run"]))).toBe("normal");
    expect(classifyCommandRisk(command("mytool", ["create", "thing"]))).toBe("elevated");
    expect(classifyCommandRisk(command("mytool", ["delete", "thing"]))).toBe("destructive");
  });

  it("commandGrantKey honors an explicitly passed scope over the computed one", () => {
    const grep = command("grep", ["-r", "x", "."]);
    expect(commandGrantKey(grep, "exact_command")).toMatch(/^exact:/);
    expect(commandGrantKey(grep)).toMatch(/^executable:/);
  });

  it("programName strips directories and a Windows .exe suffix", () => {
    expect(programName({ program: "/usr/local/bin/Node" })).toBe("node");
    expect(programName({ program: "C:\\Tools\\Git.EXE" })).toBe("git");
    expect(programName({ program: "npm" })).toBe("npm");
  });

  it("an executable given by relative path is identified by its resolved location", () => {
    const fromRoot = command("./scripts/lint.sh", [], "/workspace");
    const fromSub = command("../scripts/lint.sh", [], "/workspace/src");
    const bare = command("lint.sh", [], "/workspace");

    expect(commandExecutableSignature(fromRoot)).toBe(commandExecutableSignature(fromSub));
    expect(commandExecutableSignature(fromRoot)).not.toBe(commandExecutableSignature(bare));
  });
});

describe("resolvePath", () => {
  it("joins a relative path onto the base and collapses . and ..", () => {
    expect(resolvePath("/workspace", ".")).toBe("/workspace");
    expect(resolvePath("/workspace", "src/./lib/../app")).toBe("/workspace/src/app");
    expect(resolvePath("/workspace/", "src")).toBe("/workspace/src");
  });

  it("keeps an absolute path absolute", () => {
    expect(resolvePath("/workspace", "/elsewhere/x")).toBe("/elsewhere/x");
  });

  it("does not climb above the root", () => {
    expect(resolvePath("/workspace", "../../..")).toBe("/");
  });

  it("handles Windows drive paths with either separator", () => {
    expect(resolvePath("C:\\ws", "src/lib")).toBe("C:\\ws\\src\\lib");
    expect(resolvePath("C:\\ws", "..\\other")).toBe("C:\\other");
    expect(resolvePath("C:\\ws", "D:/x")).toBe("D:\\x");
  });
});
