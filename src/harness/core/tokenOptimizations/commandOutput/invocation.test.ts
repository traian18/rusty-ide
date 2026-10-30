import { describe, expect, it } from "vitest";
import { baseTool, hasFlag, hasShortFlag, packageScript, subcommand, toInvocation } from "./invocation";

describe("toInvocation", () => {
  it("unwraps runners so filters see the tool that prints the output", () => {
    expect(toInvocation("npx", ["--no-install", "vitest", "run"], 0)).toEqual({ tool: "vitest", args: ["run"], exitCode: 0 });
    expect(toInvocation("pnpm", ["exec", "jest", "--ci"], 1)).toMatchObject({ tool: "jest", args: ["--ci"] });
    expect(toInvocation("python3", ["-m", "pytest", "-q"], 0)).toMatchObject({ tool: "pytest", args: ["-q"] });
    expect(toInvocation("uv", ["run", "pytest"], 0)).toMatchObject({ tool: "pytest" });
    expect(toInvocation("uv", ["pip", "install", "x"], 0)).toMatchObject({ tool: "pip", args: ["install", "x"] });
    expect(toInvocation("env", ["CI=1", "cargo", "test"], 0)).toMatchObject({ tool: "cargo", args: ["test"] });
    expect(toInvocation("/usr/bin/git", ["status"], 0)).toMatchObject({ tool: "git" });
  });

  it("maps wrapper scripts and compatible tools to one name", () => {
    expect(baseTool("./mvnw")).toBe("mvn");
    expect(baseTool("gradlew.bat")).toBe("gradle");
    expect(baseTool("tofu")).toBe("terraform");
    expect(baseTool("C:\\tools\\Git.EXE")).toBe("git");
  });
});

describe("argument predicates", () => {
  const command = toInvocation("git", ["-C", "repo", "log", "--format=%h", "-la"], 0);

  it("finds the subcommand past option values", () => {
    expect(subcommand(command, ["-C"])).toBe("log");
    expect(subcommand(command)).toBe("repo");
  });

  it("matches flags with attached values and short clusters", () => {
    expect(hasFlag(command, "--format")).toBe(true);
    expect(hasFlag(command, "-l")).toBe(false);
    expect(hasShortFlag(command, "l")).toBe(true);
  });

  it("reads the package script a package manager runs", () => {
    expect(packageScript(toInvocation("npm", ["run", "test:unit"], 0))).toBe("test:unit");
    expect(packageScript(toInvocation("pnpm", ["build"], 0))).toBe("build");
    expect(packageScript(toInvocation("cargo", ["build"], 0))).toBeUndefined();
  });
});
