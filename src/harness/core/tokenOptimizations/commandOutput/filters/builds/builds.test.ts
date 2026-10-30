import { describe, expect, it } from "vitest";
import cargoCheck from "../../../../__fixtures__/checks/cargo_check.txt?raw";
import { toInvocation } from "../../invocation";
import { cargoBuildFilter } from "./cargo";
import { gradleFilter, mavenFilter } from "./jvm";
import { bundlerBuildFilter, goBuildFilter } from "./other";

const warning = (i: number, message: string) => `warning: ${message}\n --> src/f${i}.rs:${i}:1\n  |\n${i} | use x;\n  |     ^\n`;

describe("cargo", () => {
  it("counts status lines and keeps diagnostics", () => {
    const output = ["    Updating crates.io index", "  Downloaded serde v1.0.210", "  Downloaded anyhow v1.0.89", "   Compiling serde v1.0.210", "   Compiling app v0.1.0 (/work/app)", cargoCheck].join("\n");
    const out = cargoBuildFilter.apply(output, toInvocation("cargo", ["build"], 101))!;
    expect(out).not.toContain("Updating crates.io index");
    expect(out).toContain("  Downloaded 2 crates");
    expect(out).toContain("   Compiling 2 crates");
    for (const line of cargoCheck.split("\n").filter((l) => /^(error|warning)/.test(l))) expect(out).toContain(line);
  });

  it("keeps errors and the first warnings whole and counts the rest by message", () => {
    const warnings = Array.from({ length: 20 }, (_, i) => warning(i, i < 18 ? "unused import: `x`" : "unused variable: `y`")).join("\n");
    const output = `${warnings}\nerror[E0308]: mismatched types\n --> src/main.rs:3:5\n\nwarning: \`app\` (bin "app") generated 20 warnings\nerror: could not compile \`app\`\n`;
    const out = cargoBuildFilter.apply(output, toInvocation("cargo", ["check"], 101))!;
    expect(out.match(/^warning: unused/gm)).toHaveLength(15);
    expect(out).toContain("... 5 more warnings not shown: 3x unused import: `x`; 2x unused variable: `y`");
    expect(out).toContain("error[E0308]: mismatched types\n --> src/main.rs:3:5");
    expect(out).toContain("generated 20 warnings");
  });
});

describe("jvm", () => {
  it("counts Maven downloads and drops banners and passing test classes", () => {
    const output = [
      "[INFO] Scanning for projects...",
      "[INFO] ------------------------------------------------------------------------",
      "[INFO] Downloading from central: https://repo.maven.apache.org/a.pom",
      "[INFO] Downloaded from central: https://repo.maven.apache.org/a.pom (2 kB at 10 kB/s)",
      "[INFO] --- surefire:3.2.5:test (default-test) @ app ---",
      "[INFO] Running com.example.OkTest",
      "[INFO] Tests run: 3, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0.1 s - in com.example.OkTest",
      "[ERROR] Tests run: 2, Failures: 1, Errors: 0, Skipped: 0, Time elapsed: 0.2 s <<< FAILURE! - in com.example.BadTest",
      "[INFO]",
      "[INFO] BUILD FAILURE",
    ].join("\n");
    expect(mavenFilter.apply(output, toInvocation("./mvnw", ["test"], 1))!.split("\n")).toEqual([
      "[INFO] (2 dependency downloads hidden)",
      "[INFO] --- surefire:3.2.5:test (default-test) @ app ---",
      "[ERROR] Tests run: 2, Failures: 1, Errors: 0, Skipped: 0, Time elapsed: 0.2 s <<< FAILURE! - in com.example.BadTest",
      "[INFO] BUILD FAILURE",
    ]);
  });

  it("drops Gradle's task list and keeps failures", () => {
    const out = gradleFilter.apply("> Task :compileJava UP-TO-DATE\n> Task :test FAILED\n> Task :classes\n\nFAILURE: Build failed with an exception.\nBUILD FAILED in 3s", toInvocation("gradlew", ["test"], 1))!;
    expect(out).toBe("> Task :test FAILED\n\nFAILURE: Build failed with an exception.\nBUILD FAILED in 3s");
  });
});

describe("other builds", () => {
  it("counts go module downloads", () => {
    const out = goBuildFilter.apply("go: downloading golang.org/x/mod v0.17.0\ngo: downloading github.com/a/b v1.2.3\n./main.go:3:2: undefined: x", toInvocation("go", ["build", "./..."], 1));
    expect(out).toBe("go: downloading 2 modules (names hidden)\n./main.go:3:2: undefined: x");
  });

  it("caps a bundler's output file table", () => {
    const assets = Array.from({ length: 20 }, (_, i) => `dist/assets/chunk-${i}.js   ${i + 1}.20 kB │ gzip: 0.50 kB`).join("\n");
    const out = bundlerBuildFilter.apply(`vite v7.0.0 building for production...\ntransforming (120) src/a.ts\n✓ 812 modules transformed.\n${assets}\n✓ built in 3.2s`, toInvocation("npm", ["run", "build"], 0))!;
    expect(out).not.toContain("transforming (120)");
    expect(out).toContain("  ... 8 more output files");
    expect(out).toContain("✓ built in 3.2s");
  });
});
