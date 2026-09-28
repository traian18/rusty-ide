import { describe, expect, it } from "vitest";
import { commandRisk, writeRisk } from "./riskyActions";

const lines = (count: number, prefix = "line") => Array.from({ length: count }, (_, index) => `const ${prefix}${index} = ${index};`).join("\n");

describe("writeRisk", () => {
  it("never flags creating a file, rewriting it identically, or small edits", () => {
    expect(writeRisk(undefined, "anything")).toBeUndefined();
    expect(writeRisk(lines(40), lines(40))).toBeUndefined();
    expect(writeRisk(lines(40), `${lines(40)}\nconst extra = 1;`)).toBeUndefined();
    expect(writeRisk("", "new content")).toBeUndefined();
  });

  it("flags emptying an existing file", () => {
    expect(writeRisk(lines(5), "  \n")).toBe("It empties an existing file of 5 lines.");
  });

  it("flags rewrites that drop at least half of an existing file", () => {
    const original = lines(40);
    const kept = original.split("\n").slice(0, 15).join("\n");
    expect(writeRisk(original, kept)).toBe("It removes 25 of the file's 40 lines (63%).");
    // Small files may be rewritten freely.
    expect(writeRisk(lines(10), "const x = 1;")).toBeUndefined();
  });

  it.each([
    "// ... rest of the file unchanged",
    "# rest of the code remains the same",
    "  // ... existing code ...",
    "/* existing methods unchanged */",
    "<!-- rest of the component -->",
    "// ...remaining functions unchanged",
    "// everything else unchanged",
  ])("flags a placeholder standing in for code: %s", (placeholder) => {
    const risk = writeRisk(lines(5), `const a = 1;\n${placeholder}\n`);
    expect(risk).toMatch(/^The new content contains a placeholder instead of real code/);
  });

  it("does not flag code that merely mentions those words, or a placeholder the file already had", () => {
    expect(writeRisk(lines(5), `${lines(5)}\nconst restOfFile = readRest(); // rest of file handled by reader`)).toBeUndefined();
    const withNote = `${lines(5)}\n// ... existing code ...`;
    expect(writeRisk(withNote, `${withNote}\nconst b = 2;`)).toBeUndefined();
  });
});

describe("commandRisk", () => {
  const command = (program: string, args: string[]) => ({ program, args, cwd: "/ws", timeoutMs: 1000 });

  it("flags only destructive commands", () => {
    expect(commandRisk(command("git", ["push", "--force"]))).toMatch(/destructive command/);
    expect(commandRisk(command("rm", ["-rf", "build"]))).toMatch(/destructive command/);
    expect(commandRisk(command("npm", ["install"]))).toBeUndefined();
    expect(commandRisk(command("git", ["status"]))).toBeUndefined();
  });
});
